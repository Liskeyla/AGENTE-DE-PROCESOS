"""Cliente Gemini: un modelo principal + un backup. No cascada larga."""

from __future__ import annotations

import asyncio
import logging
import random
import re
import time

try:
    from google import genai
    from google.genai import types
    from google.genai import errors as genai_errors
    GEMINI_AVAILABLE = True
except ImportError:
    genai = None
    types = None
    genai_errors = None
    GEMINI_AVAILABLE = False

logger = logging.getLogger(__name__)

_resolved_model_lock = asyncio.Lock()

# Chat: solo estos (los 2.5/3.5/2.0 alargan y fallan en tus logs)
CHAT_MODELS = (
    "gemini-flash-latest",
    "gemini-1.5-flash",
)
BACKGROUND_MODELS = (
    "gemini-flash-latest",
    "gemini-1.5-flash",
    "gemini-1.5-flash-latest",
)

_resolved_model: str | None = None
# Solo 404 reales (nunca 503)
_unavailable_models: dict[str, float] = {}
_UNAVAILABLE_TTL_SEC = 60 * 60


class LLMError(Exception):
    def __init__(self, message: str, status_code: int = 503):
        self.message = message
        self.status_code = status_code
        super().__init__(message)


def _extract_response_text(response) -> str:
    try:
        text = getattr(response, "text", None)
        if text and str(text).strip():
            return str(text).strip()
    except Exception:
        pass
    parts: list[str] = []
    try:
        for cand in getattr(response, "candidates", None) or []:
            content = getattr(cand, "content", None)
            for part in getattr(content, "parts", None) or []:
                if getattr(part, "thought", None) is True:
                    continue
                t = getattr(part, "text", None)
                if t and str(t).strip():
                    parts.append(str(t).strip())
    except Exception:
        return ""
    return "\n".join(parts).strip()


def _err_text(error: Exception | None) -> str:
    return str(error or "")


def _error_code(error: Exception | None) -> int | None:
    if error is None:
        return None
    for attr in ("code", "status_code", "status"):
        val = getattr(error, attr, None)
        if isinstance(val, int):
            return val
        if isinstance(val, str) and val.isdigit():
            return int(val)
    # Buscar code numérico en el texto: 'code': 503
    m = re.search(r"['\"]code['\"]\s*:\s*(\d{3})", _err_text(error))
    if m:
        return int(m.group(1))
    m = re.search(r"\b(404|429|503)\b", _err_text(error))
    if m:
        return int(m.group(1))
    return None


def _error_status(error: Exception | None) -> str:
    err = _err_text(error).upper()
    if "NOT_FOUND" in err:
        return "NOT_FOUND"
    if "RESOURCE_EXHAUSTED" in err:
        return "RESOURCE_EXHAUSTED"
    if "UNAVAILABLE" in err or "HIGH DEMAND" in err or "OVERLOADED" in err:
        return "UNAVAILABLE"
    return ""


def _is_not_found(error: Exception | None) -> bool:
    """Solo 404 reales. NUNCA un 503 UNAVAILABLE."""
    code = _error_code(error)
    if code == 503 or code == 429:
        return False
    if code == 404:
        return True
    if _error_status(error) == "NOT_FOUND":
        return True
    err = _err_text(error).lower()
    # Evitar confundir "unavailable" con "not found"
    if "high demand" in err or "unavailable" in err:
        return False
    return "not_found" in err or "no longer available" in err or "not available to new users" in err


def _is_quota(error: Exception | None) -> bool:
    if _error_code(error) == 429:
        return True
    return _error_status(error) == "RESOURCE_EXHAUSTED"


def _is_overloaded(error: Exception | None) -> bool:
    if _error_code(error) == 503:
        return True
    if _error_status(error) == "UNAVAILABLE":
        return True
    err = _err_text(error).lower()
    return "high demand" in err or "overloaded" in err


def _mark_unavailable(model: str) -> None:
    _unavailable_models[model] = time.time()
    logger.warning("Gemini: se omite %s (404 / no existe para esta API key)", model)


def _is_marked_unavailable(model: str) -> bool:
    ts = _unavailable_models.get(model)
    if ts is None:
        return False
    if time.time() - ts > _UNAVAILABLE_TTL_SEC:
        _unavailable_models.pop(model, None)
        return False
    return True


def _is_gemini_api_error(error: Exception) -> bool:
    if genai_errors is None:
        return False
    for name in ("APIError", "ClientError", "ServerError"):
        cls = getattr(genai_errors, name, None)
        if cls and isinstance(error, cls):
            return True
    return False


class LLMService:
    """Un modelo + un backup. Reintenta 503 en el mismo modelo antes de cambiar."""

    def __init__(self):
        from app.core.config import Settings
        cfg = Settings()
        self.provider = "gemini"
        self._cfg = cfg
        self._gemini_client = None
        self.last_model_used: str | None = None

        key = (cfg.GEMINI_API_KEY or "").strip()
        if key and GEMINI_AVAILABLE:
            try:
                self._gemini_client = genai.Client(api_key=key)
            except Exception as exc:
                logger.error("No se pudo crear cliente Gemini: %s", exc)

    @property
    def is_configured(self) -> bool:
        return self._gemini_client is not None

    @property
    def config_error(self) -> str | None:
        if self.is_configured:
            return None
        if not (self._cfg.GEMINI_API_KEY or "").strip():
            return "Falta GEMINI_API_KEY en Render → Environment."
        if not GEMINI_AVAILABLE:
            return "Falta el paquete google-genai en el servidor."
        return "No se pudo inicializar Gemini."

    def _preferred_models(self, *, fast: bool) -> list[str]:
        configured = (self._cfg.GEMINI_MODEL or "").strip() or "gemini-flash-latest"
        # Normalizar alias raros a lo que suele funcionar
        if configured in {"gemini-2.5-flash", "gemini-2.0-flash", "gemini-3.5-flash"}:
            configured = "gemini-flash-latest"
        if configured == "gemini-1.5-flash-latest":
            configured = "gemini-1.5-flash"

        resolved = _resolved_model
        models: list[str] = []

        if resolved and not _is_marked_unavailable(resolved):
            models.append(resolved)
        if configured not in models and not _is_marked_unavailable(configured):
            models.append(configured)

        pool = CHAT_MODELS if fast else BACKGROUND_MODELS
        for m in pool:
            if m not in models and not _is_marked_unavailable(m):
                models.append(m)

        if not models:
            models = ["gemini-flash-latest", "gemini-1.5-flash"]

        # Chat: máximo 2. Background: máximo 3.
        return models[:2] if fast else models[:3]

    def _call_sync(self, model: str, prompt: str) -> str:
        response = self._gemini_client.models.generate_content(
            model=model,
            contents=prompt,
            config=types.GenerateContentConfig(),
        )
        return _extract_response_text(response)

    async def _generate_with_model(self, model: str, prompt: str) -> str:
        return await asyncio.to_thread(self._call_sync, model, prompt)

    async def _call_with_retries(self, model: str, prompt: str, *, max_attempts: int = 3) -> str:
        last_err: Exception | None = None
        for attempt in range(1, max_attempts + 1):
            try:
                text = await self._generate_with_model(model, prompt)
                if text:
                    return text
                raise LLMError(f"Gemini ({model}) no devolvió texto.", 502)
            except Exception as e:
                last_err = e
                if _is_not_found(e) or _is_quota(e):
                    raise
                if _is_overloaded(e) and attempt < max_attempts:
                    delay = (1.0 * attempt) + random.uniform(0, 0.4)
                    logger.warning(
                        "Gemini %s saturado (503); reintento %s/%s en %.1fs",
                        model,
                        attempt,
                        max_attempts,
                        delay,
                    )
                    await asyncio.sleep(delay)
                    continue
                if _is_overloaded(e):
                    raise
                # Otros errores: un reintento corto
                if attempt < max_attempts:
                    await asyncio.sleep(0.5)
                    continue
                raise
        if last_err:
            raise last_err
        raise LLMError(f"Gemini ({model}) no respondió.", 502)

    async def generate(
        self,
        system: str,
        user: str,
        json_mode: bool = False,
        temperature: float = 0.2,
        *,
        single_shot: bool = True,
        fast: bool = True,
    ) -> str:
        _ = (json_mode, temperature, single_shot)
        if not self.is_configured:
            raise RuntimeError(self.config_error or "Gemini no configurado.")

        from app.services.prompt_utils import cap_llm_prompts
        system, user = cap_llm_prompts(system, user)
        prompt = f"{system}\n\n---\n\n{user}"

        global _resolved_model
        last_err: Exception | None = None
        tried: list[str] = []
        saw_overload = False

        for model in self._preferred_models(fast=fast):
            tried.append(model)
            try:
                text = await self._call_with_retries(model, prompt, max_attempts=3 if fast else 2)
                async with _resolved_model_lock:
                    _resolved_model = model
                self.last_model_used = model
                logger.info("Gemini OK con modelo: %s", model)
                return text
            except Exception as e:
                last_err = e
                if _is_quota(e):
                    raise LLMError(
                        "Cuota de Gemini agotada. Espera unos minutos e intenta de nuevo.",
                        429,
                    ) from e
                if _is_not_found(e):
                    _mark_unavailable(model)
                    async with _resolved_model_lock:
                        if _resolved_model == model:
                            _resolved_model = None
                    logger.warning("Modelo 404, probando backup: %s", model)
                    continue
                if _is_overloaded(e) or _is_gemini_api_error(e) and _is_overloaded(e):
                    saw_overload = True
                    async with _resolved_model_lock:
                        if _resolved_model == model:
                            _resolved_model = None
                    logger.warning("Modelo saturado (503), backup: %s", model)
                    continue
                logger.warning("Gemini %s falló: %s", model, _err_text(e)[:220])
                # Si parece 503 aunque no clasifique perfecto, no abandones aún
                if "503" in _err_text(e) or "high demand" in _err_text(e).lower():
                    saw_overload = True
                    continue
                continue

        if saw_overload or (last_err is not None and _is_overloaded(last_err)):
            raise LLMError(
                "Gemini está saturado (alta demanda). Espera 20–40 segundos y pulsa Reintentar.",
                503,
            ) from last_err

        detail = self._friendly_error(last_err, tried[-1] if tried else "?")
        raise LLMError(
            f"{detail} Probados: {', '.join(tried)}. "
            "En Render usa GEMINI_MODEL=gemini-flash-latest",
            502,
        )

    def _friendly_error(self, error: Exception | None, model: str) -> str:
        if error is None:
            return f"Gemini ({model}) no devolvió texto."
        if isinstance(error, LLMError):
            return error.message
        if _is_not_found(error):
            return f"Modelo no encontrado: {model}."
        if _is_quota(error):
            return "Cuota de Gemini agotada."
        if _is_overloaded(error):
            return f"Gemini ({model}) saturado por alta demanda."
        return f"Error de Gemini ({model}): {_err_text(error)[:220]}"

    async def test_connection(self) -> dict:
        if not self.is_configured:
            return {
                "ok": False,
                "provider": "gemini",
                "error": self.config_error,
                "gemini_key_present": bool((self._cfg.GEMINI_API_KEY or "").strip()),
                "google_genai_installed": GEMINI_AVAILABLE,
            }
        try:
            text = await self.generate(
                system="Responde en una palabra.",
                user="di hola",
                fast=True,
            )
            return {
                "ok": True,
                "provider": "gemini",
                "model": self.last_model_used,
                "configured_model": self._cfg.GEMINI_MODEL,
                "resolved_model": _resolved_model,
                "unavailable_skipped": list(_unavailable_models.keys()),
                "sample": (text or "").strip()[:80],
            }
        except LLMError as e:
            return {
                "ok": False,
                "provider": "gemini",
                "error": e.message,
                "configured_model": self._cfg.GEMINI_MODEL,
                "unavailable_skipped": list(_unavailable_models.keys()),
            }
        except Exception as e:
            return {"ok": False, "provider": "gemini", "error": str(e)[:300]}

    async def embed(self, text: str) -> list[float]:
        if not self.is_configured:
            return [0.0] * 8
        try:
            def _call():
                return self._gemini_client.models.embed_content(
                    model=self._cfg.GEMINI_EMBEDDING_MODEL or "text-embedding-004",
                    contents=text,
                )

            result = await asyncio.to_thread(_call)
            if result.embeddings:
                return list(result.embeddings[0].values)
        except Exception as exc:
            logger.warning("Embedding omitido: %s", exc)
        return [0.0] * 8
