"""Cliente Gemini: chat rápido primero; fallback corto solo si hace falta."""

from __future__ import annotations

import asyncio
import logging
import random

try:
    from google import genai
    from google.genai import types
    from google.genai.errors import ClientError as GeminiClientError
    GEMINI_AVAILABLE = True
except ImportError:
    genai = None
    types = None
    GeminiClientError = Exception
    GEMINI_AVAILABLE = False

logger = logging.getLogger(__name__)

# Solo protege la variable de modelo resuelto (no serializa las llamadas al API)
_resolved_model_lock = asyncio.Lock()

# Modelos de respaldo cortos (orden de preferencia tras el configurado)
FAST_FALLBACK_MODELS = (
    "gemini-2.5-flash",
    "gemini-flash-latest",
    "gemini-2.0-flash",
    "gemini-3.5-flash",
)
FULL_FALLBACK_MODELS = (
    "gemini-2.5-flash",
    "gemini-flash-latest",
    "gemini-2.0-flash",
    "gemini-3.5-flash",
)

# Cache de proceso
_resolved_model: str | None = None


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


def _is_not_found(error: Exception | None) -> bool:
    err = _err_text(error).lower()
    return (
        "404" in err
        or "not_found" in err
        or "no longer available" in err
        or "not available to new users" in err
    )


def _is_quota(error: Exception | None) -> bool:
    err = _err_text(error).lower()
    return "429" in err or "resource_exhausted" in err


def _is_overloaded(error: Exception | None) -> bool:
    err = _err_text(error).lower()
    return (
        "503" in err
        or "unavailable" in err
        or "high demand" in err
        or "overloaded" in err
    )


class LLMService:
    """Gemini priorizando latencia del chat (sin cola global de llamadas)."""

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
        configured = (self._cfg.GEMINI_MODEL or "").strip()
        resolved = _resolved_model
        models: list[str] = []

        # 1) Modelo que ya funcionó (camino rápido)
        if resolved:
            models.append(resolved)
        # 2) Configurado en Render/.env
        if configured and configured not in models:
            models.append(configured)

        pool = FAST_FALLBACK_MODELS if fast else FULL_FALLBACK_MODELS
        for m in pool:
            if m not in models:
                models.append(m)

        # Chat: hasta 3 modelos (rápido pero con un backup extra)
        if fast:
            return models[:3]
        return models[:4]

    def _call_sync(self, model: str, prompt: str) -> str:
        response = self._gemini_client.models.generate_content(
            model=model,
            contents=prompt,
            config=types.GenerateContentConfig(),
        )
        return _extract_response_text(response)

    async def _generate_with_model(self, model: str, prompt: str) -> str:
        return await asyncio.to_thread(self._call_sync, model, prompt)

    async def _try_model_once(
        self,
        model: str,
        prompt: str,
        *,
        allow_one_retry: bool,
    ) -> str:
        try:
            text = await self._generate_with_model(model, prompt)
            if text:
                return text
            raise LLMError(f"Gemini ({model}) no devolvió texto.", 502)
        except GeminiClientError as e:
            if _is_not_found(e) or _is_quota(e):
                raise
            if allow_one_retry and _is_overloaded(e):
                delay = 0.7 + random.uniform(0, 0.4)
                logger.warning("Gemini %s saturado; reintento corto en %.1fs", model, delay)
                await asyncio.sleep(delay)
                text = await self._generate_with_model(model, prompt)
                if text:
                    return text
                raise
            raise

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
        fast=True (chat): 1–2 modelos, como máximo 1 reintento corto. No bloquea otras llamadas.
        fast=False (background/docs): un poco más de fallback, sin cola global.
        """
        _ = (json_mode, temperature, single_shot)
        if not self.is_configured:
            raise RuntimeError(self.config_error or "Gemini no configurado.")

        from app.services.prompt_utils import cap_llm_prompts
        system, user = cap_llm_prompts(system, user)
        prompt = f"{system}\n\n---\n\n{user}"

        global _resolved_model
        last_err: Exception | None = None
        tried: list[str] = []
        overloaded_all = True

        for idx, model in enumerate(self._preferred_models(fast=fast)):
            tried.append(model)
            # En chat: reintento corto en el 1.er y 2.º modelo
            allow_retry = (not fast) or idx < 2
            try:
                text = await self._try_model_once(
                    model, prompt, allow_one_retry=allow_retry,
                )
                if text:
                    async with _resolved_model_lock:
                        _resolved_model = model
                    self.last_model_used = model
                    if idx > 0:
                        logger.info("Gemini fallback OK: %s", model)
                    return text
            except GeminiClientError as e:
                last_err = e
                if _is_quota(e):
                    raise LLMError(
                        "Cuota de Gemini agotada. Espera unos minutos e intenta de nuevo.",
                        429,
                    ) from e
                if _is_not_found(e):
                    overloaded_all = False
                    async with _resolved_model_lock:
                        if _resolved_model == model:
                            _resolved_model = None
                    logger.warning("Modelo no disponible: %s", model)
                    continue
                if _is_overloaded(e):
                    async with _resolved_model_lock:
                        if _resolved_model == model:
                            _resolved_model = None
                    logger.warning("Modelo saturado, siguiente: %s", model)
                    continue
                overloaded_all = False
                logger.warning("Gemini %s falló: %s", model, _err_text(e)[:200])
                continue
            except LLMError as e:
                last_err = e
                if e.status_code == 429:
                    raise
                overloaded_all = False
                logger.warning("Gemini %s: %s", model, e.message[:200])
                continue
            except Exception as e:
                last_err = e
                overloaded_all = False
                logger.warning("Gemini %s excepción: %s", model, e)
                continue

        if overloaded_all and last_err is not None and _is_overloaded(last_err):
            raise LLMError(
                "Gemini está saturado ahora. Espera un momento e intenta de nuevo.",
                503,
            ) from last_err

        detail = self._friendly_error(last_err, tried[-1] if tried else "?")
        raise LLMError(
            f"{detail} Probados: {', '.join(tried)}.",
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
        err = _err_text(error)
        if "400" in err or "INVALID_ARGUMENT" in err or "invalid argument" in err.lower():
            return f"Petición inválida con modelo {model}."
        return f"Error de Gemini ({model}): {err[:220]}"

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
