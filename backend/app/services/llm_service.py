"""Cliente Gemini: detecta un modelo válido una vez y lo reutiliza (sin cascadas por turno)."""

from __future__ import annotations

import asyncio
import logging

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

# Orden: primero el que ya nos dio «Hola» en producción
CANDIDATE_MODELS = (
    "gemini-3.5-flash",
    "gemini-flash-latest",
    "gemini-2.5-flash",
    "gemini-3.6-flash",
    "gemini-3-flash-preview",
)

# Cache de proceso: el primer modelo que responde bien
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


class LLMService:
    """Gemini: una llamada por generate(); elige modelo válido solo si hace falta."""

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
        if _resolved_model:
            models.append(_resolved_model)
        if configured and configured not in models:
            models.append(configured)
        for m in CANDIDATE_MODELS:
            if m not in models:
                models.append(m)
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
            # Si ya sabemos qué modelo funciona: UNA sola llamada
            if _resolved_model:
                try:
                    text = await self._generate_with_model(_resolved_model, prompt)
                    if text:
                        self.last_model_used = _resolved_model
                        return text
                except GeminiClientError as e:
                    err = str(e)
                    if "404" in err or "NOT_FOUND" in err or "no longer available" in err.lower():
                        logger.warning("Modelo cacheado inválido (%s); redescubriendo", _resolved_model)
                        _resolved_model = None
                    else:
                        raise LLMError(self._friendly_error(e, _resolved_model), 502) from e

            # Descubrimiento: probar candidatos hasta el primero que responda
            last_err: Exception | None = None
            tried: list[str] = []
            for model in self._preferred_models():
                tried.append(model)
                try:
                    text = await self._generate_with_model(model, prompt)
                    if text:
                        _resolved_model = model
                        self.last_model_used = model
                        logger.info("Gemini modelo activo: %s", model)
                        return text
                except GeminiClientError as e:
                    last_err = e
                    err = str(e)
                    if (
                        "404" in err
                        or "NOT_FOUND" in err
                        or "no longer available" in err.lower()
                        or "not available to new users" in err.lower()
                    ):
                        logger.warning("Modelo no disponible: %s", model)
                        continue
                    if "429" in err or "RESOURCE_EXHAUSTED" in err:
                        raise LLMError("Cuota de Gemini agotada. Espera e intenta de nuevo.", 429) from e
                    # 400 u otro: probar siguiente candidato una vez
                    logger.warning("Gemini %s falló: %s", model, err[:200])
                    continue
                except Exception as e:
                    last_err = e
                    logger.warning("Gemini %s excepción: %s", model, e)
                    continue

            detail = self._friendly_error(last_err, tried[-1] if tried else "?")
            raise LLMError(
                f"{detail} Probados: {', '.join(tried)}. "
                "En Render prueba GEMINI_MODEL=gemini-3.5-flash",
                502,
            )

    def _friendly_error(self, error: Exception | None, model: str) -> str:
        if error is None:
            return f"Gemini ({model}) no devolvió texto."
        err = str(error)
        if "404" in err or "NOT_FOUND" in err:
            return f"Modelo no encontrado: {model}."
        if "400" in err or "INVALID_ARGUMENT" in err or "invalid argument" in err.lower():
            return f"Petición inválida con modelo {model}."
        if "429" in err or "RESOURCE_EXHAUSTED" in err:
            return "Cuota de Gemini agotada."
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
