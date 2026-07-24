import asyncio

from app.core.config import settings

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


class LLMError(Exception):
    """Error controlado del proveedor de IA."""

    def __init__(self, message: str, status_code: int = 503):
        self.message = message
        self.status_code = status_code
        super().__init__(message)


FALLBACK_MODELS = [
    "gemini-2.0-flash-lite",
    "gemini-2.0-flash",
    "gemini-1.5-flash",
    "gemini-2.5-flash",
]

RETRYABLE_CODES = ("429", "503", "UNAVAILABLE", "RESOURCE_EXHAUSTED")
MAX_RETRIES_PER_MODEL = 3

# Una sola llamada HTTP a la vez: evita colgar el chat con background
_llm_generate_lock = asyncio.Lock()


class LLMService:
    """Proveedor de IA exclusivo: Google Gemini (GEMINI_API_KEY)."""

    def __init__(self):
        from app.core.config import Settings
        cfg = Settings()
        self.provider = "gemini"
        self._gemini_client = None
        self._cfg = cfg

        if not cfg.GEMINI_API_KEY.strip():
            return
        if not GEMINI_AVAILABLE:
            return
        self._gemini_client = genai.Client(api_key=cfg.GEMINI_API_KEY.strip())

    @property
    def is_configured(self) -> bool:
        return self._gemini_client is not None

    async def generate(
        self,
        system: str,
        user: str,
        json_mode: bool = True,
        temperature: float = 0.2,
        *,
        single_shot: bool = False,
    ) -> str:
        """Una generación Gemini. Con single_shot=True: 1 modelo, hasta 2 intentos."""
        if not self.is_configured:
            raise RuntimeError(
                "No hay API key de Gemini. En Render → Environment agrega la variable "
                "GEMINI_API_KEY (con guiones bajos) y pega tu clave de Google AI Studio."
            )

        from app.services.prompt_utils import cap_llm_prompts
        system, user = cap_llm_prompts(system, user)

        async with _llm_generate_lock:
            return await self._generate_gemini(
                system, user, json_mode, temperature, single_shot=single_shot,
            )

    async def _generate_gemini(
        self,
        system: str,
        user: str,
        json_mode: bool,
        temperature: float,
        *,
        single_shot: bool = False,
    ) -> str:
        config_kwargs = {"temperature": temperature}
        if json_mode:
            config_kwargs["response_mime_type"] = "application/json"

        config = types.GenerateContentConfig(**config_kwargs)
        prompt = f"{system}\n\n---\n\n{user}"

        if single_shot:
            models_to_try = [self._cfg.GEMINI_MODEL]
            max_retries = 2
        else:
            models_to_try = [self._cfg.GEMINI_MODEL] + [
                m for m in FALLBACK_MODELS if m != self._cfg.GEMINI_MODEL
            ]
            max_retries = MAX_RETRIES_PER_MODEL
        last_error = None

        for model in models_to_try:
            for attempt in range(max_retries):
                try:
                    def _call(m=model):
                        return self._gemini_client.models.generate_content(
                            model=m,
                            contents=prompt,
                            config=config,
                        )

                    response = await asyncio.to_thread(_call)
                    return response.text or ""
                except GeminiClientError as e:
                    last_error = e
                    err_str = str(e)
                    if any(code in err_str for code in RETRYABLE_CODES):
                        if attempt < max_retries - 1:
                            await asyncio.sleep(1.5 * (attempt + 1))
                            continue
                        break
                    if "404" in err_str or "NOT_FOUND" in err_str:
                        break
                    raise LLMError(self._friendly_gemini_error(e), 502) from e
                except Exception as e:
                    raise LLMError(f"Error al conectar con Gemini: {e}", 502) from e

        raise LLMError(self._friendly_gemini_error(last_error), 429)

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
            return "Gemini no respondió. Verifica tu API key y cuota en Google AI Studio."
        err = str(error)
        google_msg = self._extract_google_message(error)
        if "429" in err or "RESOURCE_EXHAUSTED" in err or "quota" in err.lower():
            return (
                "Cuota de Gemini agotada o no disponible. "
                "Espera unos minutos o habilita facturación en Google AI Studio: "
                "https://aistudio.google.com/apikey"
            )
        if "503" in err or "UNAVAILABLE" in err:
            return (
                "Gemini tiene alta demanda temporal. "
                "Espera unos segundos e intenta de nuevo."
            )
        if "401" in err or "UNAUTHENTICATED" in err:
            return "API key de Gemini inválida. Verifica GEMINI_API_KEY en Render."
        if "403" in err or "PERMISSION_DENIED" in err:
            return (
                "Tu API key de Gemini fue rechazada. "
                f"Detalle de Google: {google_msg}. "
                "Genera una nueva key en https://aistudio.google.com/apikey "
                "y actualiza GEMINI_API_KEY en Render."
            )
        return f"Error de Gemini: {google_msg}"

    async def test_connection(self) -> dict:
        if not self.is_configured:
            return {
                "ok": False,
                "provider": "gemini",
                "error": (
                    "Falta la variable GEMINI_API_KEY en Render → Environment. "
                    "Créala con guiones bajos, pega la clave de https://aistudio.google.com/apikey "
                    "y reinicia el servicio."
                ),
                "gemini_key_present": bool((self._cfg.GEMINI_API_KEY or "").strip()),
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
                "model": self._cfg.GEMINI_MODEL,
                "sample": (text or "").strip()[:80],
            }
        except LLMError as e:
            return {"ok": False, "provider": "gemini", "error": e.message}
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
