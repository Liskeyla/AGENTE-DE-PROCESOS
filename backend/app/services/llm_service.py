import asyncio
import logging

from app.core.config import DEPRECATED_GEMINI_MODELS, settings

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


class LLMError(Exception):
    """Error controlado del proveedor de IA."""

    def __init__(self, message: str, status_code: int = 503):
        self.message = message
        self.status_code = status_code
        super().__init__(message)


# Orden de calidad/estabilidad para la entrevista (mejor → respaldo)
PREFERRED_MODELS = [
    "gemini-3.5-flash",      # mejor equilibrio calidad/velocidad (recomendado)
    "gemini-3.6-flash",      # más nuevo si está habilitado en la cuenta
    "gemini-flash-latest",   # alias que Google actualiza solo
    "gemini-3.1-pro",        # máxima calidad (más lento / menos RPM)
    "gemini-2.5-flash",      # respaldo si los 3.x fallan
]

RETRYABLE_CODES = ("429", "503", "UNAVAILABLE", "RESOURCE_EXHAUSTED")
MODEL_GONE_MARKERS = (
    "404",
    "NOT_FOUND",
    "no longer available",
    "is not found",
    "not supported",
    "not available to new users",
)
INVALID_ARG_MARKERS = ("invalid argument", "INVALID_ARGUMENT", "400")
MAX_RETRIES_PER_MODEL = 2

_llm_generate_lock = asyncio.Lock()


def _extract_response_text(response) -> str:
    """Obtiene texto aunque Gemini 2.5 use 'thinking' y .text venga vacío."""
    try:
        text = getattr(response, "text", None)
        if text and str(text).strip():
            return str(text)
    except Exception:
        pass

    parts_out: list[str] = []
    try:
        for cand in getattr(response, "candidates", None) or []:
            content = getattr(cand, "content", None)
            for part in getattr(content, "parts", None) or []:
                # Ignorar partes solo de pensamiento si el SDK las marca
                thought = getattr(part, "thought", None)
                if thought is True:
                    continue
                t = getattr(part, "text", None)
                if t and str(t).strip():
                    parts_out.append(str(t))
    except Exception:
        return ""
    return "".join(parts_out).strip()


class LLMService:
    """Proveedor de IA exclusivo: Google Gemini (GEMINI_API_KEY)."""

    def __init__(self):
        from app.core.config import Settings
        cfg = Settings()
        self.provider = "gemini"
        self._gemini_client = None
        self._cfg = cfg
        self.last_model_used: str | None = None

        if not cfg.GEMINI_API_KEY.strip():
            return
        if not GEMINI_AVAILABLE:
            return
        try:
            self._gemini_client = genai.Client(api_key=cfg.GEMINI_API_KEY.strip())
        except Exception:
            self._gemini_client = None

    @property
    def is_configured(self) -> bool:
        return self._gemini_client is not None

    @property
    def config_error(self) -> str | None:
        if self._gemini_client is not None:
            return None
        if not (self._cfg.GEMINI_API_KEY or "").strip():
            return (
                "Falta la variable GEMINI_API_KEY en Render → Environment "
                "(con guiones bajos). Pega la clave de Google AI Studio y reinicia."
            )
        if not GEMINI_AVAILABLE:
            return (
                "El paquete google-genai no está instalado en el servidor. "
                "Revisa requirements-render.txt y redespliega."
            )
        return "No se pudo inicializar el cliente de Gemini con la clave configurada."

    def _build_config(
        self,
        *,
        json_mode: bool,
        temperature: float,
        include_temperature: bool = True,
    ):
        """Config mínima: thinking_budget=0 rompe en varios modelos (invalid argument)."""
        kwargs: dict = {}
        if include_temperature:
            kwargs["temperature"] = temperature
        if json_mode:
            kwargs["response_mime_type"] = "application/json"
        return types.GenerateContentConfig(**kwargs)

    def _models_to_try(self, *, allow_fallbacks: bool) -> list[str]:
        primary = DEPRECATED_GEMINI_MODELS.get(
            (self._cfg.GEMINI_MODEL or "").strip(),
            (self._cfg.GEMINI_MODEL or "").strip(),
        ) or "gemini-3.5-flash"
        models = [primary]
        if allow_fallbacks:
            for m in PREFERRED_MODELS:
                if m not in models:
                    models.append(m)
        return models

    async def generate(
        self,
        system: str,
        user: str,
        json_mode: bool = True,
        temperature: float = 0.2,
        *,
        single_shot: bool = False,
    ) -> str:
        """Genera con Gemini. Si el modelo está retirado, prueba el siguiente vigente."""
        if not self.is_configured:
            raise RuntimeError(self.config_error or "Gemini no está configurado.")

        from app.services.prompt_utils import cap_llm_prompts
        system, user = cap_llm_prompts(system, user)

        async with _llm_generate_lock:
            return await self._generate_gemini(
                system,
                user,
                json_mode,
                temperature,
                # Aunque sea chat, permitir cambio de modelo si Google lo retiró
                allow_model_fallback=True,
                max_retries=1 if single_shot else MAX_RETRIES_PER_MODEL,
            )

    async def _generate_gemini(
        self,
        system: str,
        user: str,
        json_mode: bool,
        temperature: float,
        *,
        allow_model_fallback: bool = True,
        max_retries: int = MAX_RETRIES_PER_MODEL,
    ) -> str:
        prompt = f"{system}\n\n---\n\n{user}"
        models_to_try = self._models_to_try(allow_fallbacks=allow_model_fallback)
        last_error = None
        tried: list[str] = []

        for model in models_to_try:
            tried.append(model)
            # Gemini 3.x a veces rechaza temperature → reintentar sin ella
            config_variants = [
                self._build_config(json_mode=json_mode, temperature=temperature, include_temperature=True),
                self._build_config(json_mode=json_mode, temperature=temperature, include_temperature=False),
            ]
            for config in config_variants:
                for attempt in range(max(1, max_retries)):
                    try:
                        def _call(m=model, cfg=config):
                            return self._gemini_client.models.generate_content(
                                model=m,
                                contents=prompt,
                                config=cfg,
                            )

                        response = await asyncio.to_thread(_call)
                        text = _extract_response_text(response)
                        if not text:
                            raise LLMError(
                                f"Gemini ({model}) respondió vacío. Prueba otro modelo o reintenta.",
                                502,
                            )
                        self.last_model_used = model
                        return text
                    except LLMError as e:
                        last_error = e
                        break  # siguiente variante/modelo
                    except GeminiClientError as e:
                        last_error = e
                        err_str = str(e)
                        if any(marker in err_str for marker in INVALID_ARG_MARKERS):
                            # probar siguiente variante de config (sin temperature)
                            break
                        if any(code in err_str for code in RETRYABLE_CODES):
                            if attempt < max_retries - 1:
                                await asyncio.sleep(1.2 * (attempt + 1))
                                continue
                            break
                        if any(marker.lower() in err_str.lower() for marker in MODEL_GONE_MARKERS):
                            logger.warning("Modelo Gemini no disponible: %s (%s)", model, err_str[:200])
                            break
                        raise LLMError(self._friendly_gemini_error(e), 502) from e
                    except Exception as e:
                        raise LLMError(f"Error al conectar con Gemini: {e}", 502) from e
                else:
                    continue
                # si INVALID_ARG o vacío, sigue a la otra variante; si modelo gone, sale al siguiente modelo
                if last_error and any(
                    m.lower() in str(last_error).lower() for m in MODEL_GONE_MARKERS
                ):
                    break

        detail = self._friendly_gemini_error(last_error if isinstance(last_error, Exception) else None)
        if isinstance(last_error, LLMError):
            detail = last_error.message
        raise LLMError(
            f"{detail} Modelos intentados: {', '.join(tried)}.",
            429,
        )

    def _extract_google_message(self, error: Exception) -> str:
        err = str(error)
        if "'message':" in err:
            import re
            m = re.search(r"'message':\s*'([^']+)'", err)
            if m:
                return m.group(1)
        return err[:300]

    def _friendly_gemini_error(self, error: Exception | None) -> str:
        if error is None:
            return "Gemini no respondió. Verifica tu API key y el modelo en Render."
        err = str(error)
        google_msg = self._extract_google_message(error)
        if "429" in err or "RESOURCE_EXHAUSTED" in err or "quota" in err.lower():
            return (
                "Cuota de Gemini agotada o no disponible. "
                "Espera unos minutos o revisa facturación en Google AI Studio."
            )
        if "503" in err or "UNAVAILABLE" in err:
            return "Gemini tiene alta demanda temporal. Espera unos segundos e intenta de nuevo."
        if "401" in err or "UNAUTHENTICATED" in err:
            return "API key de Gemini inválida. Verifica GEMINI_API_KEY en Render."
        if "403" in err or "PERMISSION_DENIED" in err:
            return (
                "Tu API key de Gemini fue rechazada. "
                f"Detalle: {google_msg}. "
                "Genera una nueva key en https://aistudio.google.com/apikey"
            )
        if any(m.lower() in err.lower() for m in MODEL_GONE_MARKERS):
            return (
                "El modelo de Gemini configurado ya no está disponible. "
                "En Render pon GEMINI_MODEL=gemini-2.5-flash"
            )
        return f"Error de Gemini: {google_msg}"

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
                single_shot=True,
            )
            return {
                "ok": True,
                "provider": "gemini",
                "model": self.last_model_used or self._cfg.GEMINI_MODEL,
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
