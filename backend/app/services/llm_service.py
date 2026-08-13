"""Cliente Gemini: reintentos ante 503 y cascada de modelos de respaldo."""

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
_llm_generate_lock = asyncio.Lock()

# Preferir flash estable primero; los preview/3.x suelen saturarse más
CANDIDATE_MODELS = (
    "gemini-2.5-flash",
    "gemini-flash-latest",
    "gemini-2.0-flash",
    "gemini-3.5-flash",
    "gemini-3-flash-preview",
    "gemini-3.6-flash",
)

# Cache de proceso: el último modelo que respondió bien
_resolved_model: str | None = None

_MAX_RETRIES_PER_MODEL = 3
_RETRY_BASE_SECONDS = 1.2


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
        or "temporarily" in err and "unavailable" in err
    )


class LLMService:
    """Gemini con reintentos y fallback entre modelos cuando hay saturación."""

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

    def _preferred_models(self) -> list[str]:
        global _resolved_model
        configured = (self._cfg.GEMINI_MODEL or "").strip()
        models: list[str] = []
        # En saturación conviene probar primero alternativas estables, no solo el cacheado
        if configured and configured not in models:
            models.append(configured)
        for m in CANDIDATE_MODELS:
            if m not in models:
                models.append(m)
        if _resolved_model and _resolved_model not in models:
            models.insert(0, _resolved_model)
        elif _resolved_model:
            # Mantener el que funcionó cerca del inicio, tras el configurado
            models = [m for m in models if m != _resolved_model]
            insert_at = 1 if configured else 0
            models.insert(insert_at, _resolved_model)
        return models

    def _call_sync(self, model: str, prompt: str) -> str:
        response = self._gemini_client.models.generate_content(
            model=model,
            contents=prompt,
            config=types.GenerateContentConfig(),
        )
        return _extract_response_text(response)

    async def _generate_with_model(self, model: str, prompt: str) -> str:
        return await asyncio.to_thread(self._call_sync, model, prompt)

    async def _generate_with_retries(self, model: str, prompt: str) -> str:
        last_err: Exception | None = None
        for attempt in range(1, _MAX_RETRIES_PER_MODEL + 1):
            try:
                text = await self._generate_with_model(model, prompt)
                if text:
                    return text
                raise LLMError(f"Gemini ({model}) no devolvió texto.", 502)
            except GeminiClientError as e:
                last_err = e
                if _is_not_found(e) or _is_quota(e):
                    raise
                if _is_overloaded(e) and attempt < _MAX_RETRIES_PER_MODEL:
                    delay = _RETRY_BASE_SECONDS * (2 ** (attempt - 1)) + random.uniform(0, 0.6)
                    logger.warning(
                        "Gemini %s saturado (intento %s/%s); reintento en %.1fs",
                        model,
                        attempt,
                        _MAX_RETRIES_PER_MODEL,
                        delay,
                    )
                    await asyncio.sleep(delay)
                    continue
                raise
            except LLMError:
                raise
            except Exception as e:
                last_err = e
                if attempt < _MAX_RETRIES_PER_MODEL:
                    delay = _RETRY_BASE_SECONDS * attempt
                    logger.warning(
                        "Gemini %s error temporal (intento %s/%s): %s",
                        model,
                        attempt,
                        _MAX_RETRIES_PER_MODEL,
                        e,
                    )
                    await asyncio.sleep(delay)
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
    ) -> str:
        _ = (json_mode, temperature, single_shot)
        if not self.is_configured:
            raise RuntimeError(self.config_error or "Gemini no configurado.")

        from app.services.prompt_utils import cap_llm_prompts
        system, user = cap_llm_prompts(system, user)
        prompt = f"{system}\n\n---\n\n{user}"

        global _resolved_model
        async with _llm_generate_lock:
            last_err: Exception | None = None
            tried: list[str] = []
            overloaded_all = True

            for model in self._preferred_models():
                tried.append(model)
                try:
                    text = await self._generate_with_retries(model, prompt)
                    if text:
                        _resolved_model = model
                        self.last_model_used = model
                        logger.info("Gemini modelo activo: %s", model)
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
                        if _resolved_model == model:
                            _resolved_model = None
                        logger.warning("Modelo no disponible: %s", model)
                        continue
                    if _is_overloaded(e):
                        if _resolved_model == model:
                            _resolved_model = None
                        logger.warning("Modelo saturado, probando siguiente: %s", model)
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
                    "Gemini está saturado en este momento (alta demanda). "
                    "Espera 1–2 minutos e intenta de nuevo. "
                    f"Modelos probados: {', '.join(tried)}.",
                    503,
                ) from last_err

            detail = self._friendly_error(last_err, tried[-1] if tried else "?")
            raise LLMError(
                f"{detail} Probados: {', '.join(tried)}. "
                "En Render puedes poner GEMINI_MODEL=gemini-2.5-flash",
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
            return (
                f"Gemini ({model}) está saturado por alta demanda. "
                "Reintenta en unos minutos."
            )
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
