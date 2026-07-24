"""Cliente Gemini mínimo: 1 modelo, 1 llamada, sin cascadas que generan 404/400."""

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

# El que ya te aparece con consumo real en AI Studio
DEFAULT_MODEL = "gemini-2.5-flash"


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
    """Gemini solo. Exactamente GEMINI_MODEL de Render. Sin reintentos multi-modelo."""

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

    def _model_name(self) -> str:
        raw = (self._cfg.GEMINI_MODEL or "").strip()
        # No reescribir a modelos 3.x que dan 404 en muchas cuentas
        if not raw or "lite" in raw.lower():
            return DEFAULT_MODEL
        return raw

    async def generate(
        self,
        system: str,
        user: str,
        json_mode: bool = True,
        temperature: float = 0.2,
        *,
        single_shot: bool = False,
    ) -> str:
        """
        Una sola llamada HTTP al modelo configurado.
        No usamos response_mime_type=json (causa muchos 400); pedimos JSON en el prompt.
        """
        _ = single_shot  # compat
        if not self.is_configured:
            raise RuntimeError(self.config_error or "Gemini no configurado.")

        from app.services.prompt_utils import cap_llm_prompts
        system, user = cap_llm_prompts(system, user)
        model = self._model_name()

        if json_mode:
            system = (
                f"{system}\n\n"
                "IMPORTANTE: responde ÚNICAMENTE con un objeto JSON válido "
                '(sin markdown). Debe incluir el campo "reply" con el texto visible.'
            )

        prompt = f"{system}\n\n---\n\n{user}"

        async with _llm_generate_lock:
            try:
                def _call():
                    # Config mínima: sin temperature forzada (evita 400 en Gemini 3)
                    config = types.GenerateContentConfig()
                    return self._gemini_client.models.generate_content(
                        model=model,
                        contents=prompt,
                        config=config,
                    )

                response = await asyncio.to_thread(_call)
                text = _extract_response_text(response)
                if not text:
                    raise LLMError(
                        f"Gemini ({model}) respondió vacío. Revisa el modelo en Render.",
                        502,
                    )
                self.last_model_used = model
                return text
            except LLMError:
                raise
            except GeminiClientError as e:
                err = str(e)
                logger.error("Gemini %s: %s", model, err[:400])
                if "404" in err or "NOT_FOUND" in err:
                    raise LLMError(
                        f"Modelo no encontrado: {model}. "
                        "En Render pon GEMINI_MODEL=gemini-2.5-flash",
                        404,
                    ) from e
                if "400" in err or "INVALID_ARGUMENT" in err or "invalid argument" in err.lower():
                    raise LLMError(
                        f"Petición rechazada por Gemini (400) con modelo {model}. "
                        "Usa GEMINI_MODEL=gemini-2.5-flash en Render.",
                        400,
                    ) from e
                if "429" in err or "RESOURCE_EXHAUSTED" in err:
                    raise LLMError("Cuota de Gemini agotada. Espera un minuto e intenta de nuevo.", 429) from e
                raise LLMError(f"Error de Gemini: {err[:280]}", 502) from e
            except Exception as e:
                raise LLMError(f"Error al conectar con Gemini: {e}", 502) from e

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
                json_mode=False,
            )
            return {
                "ok": True,
                "provider": "gemini",
                "model": self.last_model_used or self._model_name(),
                "configured_model": self._cfg.GEMINI_MODEL,
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
        """Embeddings opcionales: si el modelo no existe (404), no tumba el chat."""
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
            logger.warning("Embedding omitido (%s): %s", self._cfg.GEMINI_EMBEDDING_MODEL, exc)
        return [0.0] * 8
