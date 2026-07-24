"""Cliente Gemini simple: un solo modelo (GEMINI_MODEL) y respuestas usables."""

from __future__ import annotations

import asyncio
import logging
import re

from app.core.config import DEPRECATED_GEMINI_MODELS

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
    """Solo Gemini. Usa exactamente GEMINI_MODEL de Render (sin cascadas que gastan cuota)."""

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
        return DEPRECATED_GEMINI_MODELS.get(raw, raw) or "gemini-3.5-flash"

    async def generate(
        self,
        system: str,
        user: str,
        json_mode: bool = True,
        temperature: float = 0.2,
        *,
        single_shot: bool = False,
    ) -> str:
        if not self.is_configured:
            raise RuntimeError(self.config_error or "Gemini no configurado.")

        from app.services.prompt_utils import cap_llm_prompts
        system, user = cap_llm_prompts(system, user)
        model = self._model_name()
        prompt = f"{system}\n\n---\n\n{user}"

        async with _llm_generate_lock:
            # 1) Intento principal (con o sin JSON según pidan)
            text = await self._call_once(
                model, prompt, json_mode=json_mode, temperature=temperature,
            )
            if text:
                self.last_model_used = model
                return text

            # 2) Si JSON falló/vacío: un solo reintento en texto plano (no gasta 5 modelos)
            if json_mode:
                logger.warning("Gemini JSON vacío/falló; reintento en texto plano (%s)", model)
                text = await self._call_once(
                    model, prompt, json_mode=False, temperature=temperature,
                )
                if text:
                    self.last_model_used = model
                    return text

            raise LLMError(
                f"Gemini ({model}) no devolvió texto usable. Revisa cuota o el modelo en Render.",
                502,
            )

    async def _call_once(
        self,
        model: str,
        prompt: str,
        *,
        json_mode: bool,
        temperature: float,
    ) -> str:
        # Config mínima: temperature a veces rompe Gemini 3 → probar sin ella si falla
        configs = []
        base = {}
        if json_mode:
            base["response_mime_type"] = "application/json"
        try:
            configs.append(types.GenerateContentConfig(**{**base, "temperature": temperature}))
        except Exception:
            pass
        try:
            configs.append(types.GenerateContentConfig(**base) if base else types.GenerateContentConfig())
        except Exception:
            configs.append(None)

        last_err: Exception | None = None
        for config in configs:
            try:
                def _call(cfg=config):
                    kwargs = {"model": model, "contents": prompt}
                    if cfg is not None:
                        kwargs["config"] = cfg
                    return self._gemini_client.models.generate_content(**kwargs)

                response = await asyncio.to_thread(_call)
                return _extract_response_text(response)
            except GeminiClientError as e:
                last_err = e
                err = str(e)
                if "429" in err or "RESOURCE_EXHAUSTED" in err:
                    await asyncio.sleep(1.5)
                    continue
                if "INVALID_ARGUMENT" in err or "invalid argument" in err.lower():
                    continue
                logger.warning("Gemini error (%s): %s", model, err[:240])
                break
            except Exception as e:
                last_err = e
                logger.warning("Gemini excepción (%s): %s", model, e)
                break

        if last_err:
            logger.warning("Gemini call_once falló: %s", last_err)
        return ""

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
                temperature=0,
            )
            return {
                "ok": True,
                "provider": "gemini",
                "model": self.last_model_used or self._model_name(),
                "configured_model": self._cfg.GEMINI_MODEL,
                "sample": (text or "").strip()[:80],
            }
        except LLMError as e:
            return {"ok": False, "provider": "gemini", "error": e.message, "configured_model": self._cfg.GEMINI_MODEL}
        except Exception as e:
            return {"ok": False, "provider": "gemini", "error": str(e)[:300]}

    async def embed(self, text: str) -> list[float]:
        if not self.is_configured:
            return [0.0] * 8

        def _call():
            return self._gemini_client.models.embed_content(
                model=self._cfg.GEMINI_EMBEDDING_MODEL,
                contents=text,
            )

        result = await asyncio.to_thread(_call)
        if result.embeddings:
            return list(result.embeddings[0].values)
        return [0.0] * 8
