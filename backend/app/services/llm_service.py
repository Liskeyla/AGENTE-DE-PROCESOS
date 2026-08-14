"""Cliente Gemini: descubre los modelos reales de la API key y tolera 503 transitorios."""

from __future__ import annotations

import asyncio
import logging
import random
import re
import time

try:
    from google import genai
    from google.genai import types
    GEMINI_AVAILABLE = True
except ImportError:  # pragma: no cover
    genai = None
    types = None
    GEMINI_AVAILABLE = False

logger = logging.getLogger(__name__)

_resolved_model_lock = asyncio.Lock()

# Preferencia cuando la cuenta ofrece varios modelos válidos (flash = rápido y barato)
MODEL_PREFERENCE = (
    "gemini-3.7-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-3-flash",
    "gemini-flash-latest",
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
    "gemini-2.5-flash-lite",
)

# Semilla si el descubrimiento de modelos falla
SEED_MODELS = (
    "gemini-3.7-flash",
    "gemini-3.5-flash",
    "gemini-flash-latest",
    "gemini-2.5-flash",
)

_resolved_model: str | None = None
_available_models: list[str] = []
_available_models_at: float = 0.0
_AVAILABLE_TTL_SEC = 15 * 60

# Modelos con 404 confirmado (nunca se marca por 503)
_unavailable_models: dict[str, float] = {}
_UNAVAILABLE_TTL_SEC = 60 * 60

_CHAT_MAX_ATTEMPTS = 5
_BACKGROUND_MAX_ATTEMPTS = 3


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
    for attr in ("code", "status_code"):
        val = getattr(error, attr, None)
        if isinstance(val, int):
            return val
        if isinstance(val, str) and val.isdigit():
            return int(val)
    text = _err_text(error)
    match = re.search(r"['\"]code['\"]\s*:\s*(\d{3})", text)
    if match:
        return int(match.group(1))
    match = re.search(r"\b(400|401|403|404|429|500|503)\b", text)
    if match:
        return int(match.group(1))
    return None


def _is_quota(error: Exception | None) -> bool:
    if _error_code(error) == 429:
        return True
    return "RESOURCE_EXHAUSTED" in _err_text(error).upper()


def _is_overloaded(error: Exception | None) -> bool:
    if _error_code(error) in (500, 503):
        return True
    upper = _err_text(error).upper()
    return "UNAVAILABLE" in upper or "HIGH DEMAND" in upper or "OVERLOADED" in upper


def _is_not_found(error: Exception | None) -> bool:
    """Solo 404 real. Un 503 UNAVAILABLE nunca significa 'modelo inexistente'."""
    if _is_overloaded(error) or _is_quota(error):
        return False
    if _error_code(error) == 404:
        return True
    return "NOT_FOUND" in _err_text(error).upper()


def _clean_model_name(raw: str) -> str:
    name = (raw or "").strip()
    return name[len("models/"):] if name.startswith("models/") else name


def _mark_unavailable(model: str) -> None:
    _unavailable_models[model] = time.time()
    logger.warning("Gemini: %s no existe para esta API key; se descarta", model)


def _is_marked_unavailable(model: str) -> bool:
    stamp = _unavailable_models.get(model)
    if stamp is None:
        return False
    if time.time() - stamp > _UNAVAILABLE_TTL_SEC:
        _unavailable_models.pop(model, None)
        return False
    return True


class LLMService:
    """Gemini con descubrimiento de modelos y reintentos ante saturación."""

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

    def _list_models_sync(self) -> list[str]:
        names: list[str] = []
        for model in self._gemini_client.models.list():
            actions = (
                getattr(model, "supported_actions", None)
                or getattr(model, "supported_generation_methods", None)
                or []
            )
            actions_lower = {str(a).lower() for a in actions}
            if actions_lower and "generatecontent" not in actions_lower:
                continue
            name = _clean_model_name(getattr(model, "name", ""))
            if not name:
                continue
            if any(skip in name for skip in ("embedding", "imagen", "veo", "lyria", "tts", "robotics")):
                continue
            names.append(name)
        return names

    async def _discover_models(self) -> list[str]:
        """Modelos reales de la API key (cacheado). Lista vacía si no se pudo consultar."""
        global _available_models, _available_models_at
        if _available_models and time.time() - _available_models_at < _AVAILABLE_TTL_SEC:
            return _available_models
        try:
            names = await asyncio.to_thread(self._list_models_sync)
        except Exception as exc:
            logger.warning("No se pudo listar modelos Gemini: %s", _err_text(exc)[:200])
            return _available_models
        if names:
            _available_models = names
            _available_models_at = time.time()
            logger.info("Gemini: %s modelos disponibles para esta key", len(names))
        return _available_models

    async def _candidate_models(self) -> list[str]:
        configured = _clean_model_name(self._cfg.GEMINI_MODEL or "")
        available = await self._discover_models()
        candidates: list[str] = []

        def add(name: str) -> None:
            if not name or name in candidates or _is_marked_unavailable(name):
                return
            if available and name not in available:
                return
            candidates.append(name)

        if _resolved_model:
            add(_resolved_model)
        add(configured)
        for name in MODEL_PREFERENCE:
            add(name)

        if available:
            for name in available:
                if "flash" in name and "lite" not in name:
                    add(name)
            for name in available:
                if "flash" in name:
                    add(name)

        if not candidates:
            candidates = [m for m in SEED_MODELS if not _is_marked_unavailable(m)] or list(SEED_MODELS)

        return candidates[:5]

    def _call_sync(self, model: str, prompt: str) -> str:
        response = self._gemini_client.models.generate_content(
            model=model,
            contents=prompt,
            config=types.GenerateContentConfig(),
        )
        return _extract_response_text(response)

    async def _generate_with_model(self, model: str, prompt: str) -> str:
        return await asyncio.to_thread(self._call_sync, model, prompt)

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
        """
        Recorre los modelos reales de la cuenta. Ante 503 espera y reintenta rotando
        de modelo hasta agotar el presupuesto de intentos.
        """
        _ = (json_mode, temperature, single_shot)
        if not self.is_configured:
            raise RuntimeError(self.config_error or "Gemini no configurado.")

        from app.services.prompt_utils import cap_llm_prompts
        system, user = cap_llm_prompts(system, user)
        prompt = f"{system}\n\n---\n\n{user}"

        global _resolved_model
        candidates = await self._candidate_models()
        max_attempts = _CHAT_MAX_ATTEMPTS if fast else _BACKGROUND_MAX_ATTEMPTS

        tried: list[str] = []
        last_err: Exception | None = None
        saw_overload = False
        attempt = 0
        index = 0

        while attempt < max_attempts and candidates:
            model = candidates[index % len(candidates)]
            attempt += 1
            if model not in tried:
                tried.append(model)
            try:
                text = await self._generate_with_model(model, prompt)
                if text:
                    async with _resolved_model_lock:
                        _resolved_model = model
                    self.last_model_used = model
                    logger.info("Gemini OK (%s, intento %s)", model, attempt)
                    return text
                last_err = LLMError(f"Gemini ({model}) no devolvió texto.", 502)
                index += 1
                continue
            except Exception as exc:
                last_err = exc

                if _is_quota(exc):
                    raise LLMError(
                        "Cuota de Gemini agotada. Espera unos minutos e intenta de nuevo.",
                        429,
                    ) from exc

                if _is_not_found(exc):
                    _mark_unavailable(model)
                    candidates = [m for m in candidates if m != model]
                    async with _resolved_model_lock:
                        if _resolved_model == model:
                            _resolved_model = None
                    index = 0
                    continue

                if _is_overloaded(exc):
                    saw_overload = True
                    async with _resolved_model_lock:
                        if _resolved_model == model:
                            _resolved_model = None
                    index += 1
                    if attempt < max_attempts:
                        delay = min(0.8 * attempt, 3.0) + random.uniform(0, 0.4)
                        logger.warning(
                            "Gemini saturado (503) en %s; intento %s/%s, espera %.1fs",
                            model,
                            attempt,
                            max_attempts,
                            delay,
                        )
                        await asyncio.sleep(delay)
                    continue

                logger.warning("Gemini %s error: %s", model, _err_text(exc)[:220])
                index += 1
                if attempt < max_attempts:
                    await asyncio.sleep(0.5)
                continue

        if saw_overload:
            raise LLMError(
                "Gemini está saturado (alta demanda). Espera unos segundos y pulsa Reintentar.",
                503,
            ) from last_err

        detail = self._friendly_error(last_err, tried[-1] if tried else "?")
        raise LLMError(
            f"{detail} Probados: {', '.join(tried) or 'ninguno'}. "
            "Revisa /health/models para ver los modelos de la API key.",
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

    async def list_models_report(self) -> dict:
        """Diagnóstico: qué modelos ofrece realmente la API key."""
        if not self.is_configured:
            return {"ok": False, "error": self.config_error}
        available = await self._discover_models()
        return {
            "ok": bool(available),
            "configured_model": self._cfg.GEMINI_MODEL,
            "resolved_model": _resolved_model,
            "available_models": available,
            "candidates": await self._candidate_models(),
            "discarded_404": list(_unavailable_models.keys()),
        }

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
                "sample": (text or "").strip()[:80],
            }
        except LLMError as e:
            return {
                "ok": False,
                "provider": "gemini",
                "error": e.message,
                "configured_model": self._cfg.GEMINI_MODEL,
                "available_models": await self._discover_models(),
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
