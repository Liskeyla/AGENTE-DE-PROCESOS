import asyncio
from typing import Optional

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

try:
    from openai import AsyncOpenAI
    OPENAI_AVAILABLE = True
except ImportError:
    AsyncOpenAI = None
    OPENAI_AVAILABLE = False


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

GROQ_FALLBACK_MODELS = [
    "llama-3.1-8b-instant",
    "llama-3.3-70b-versatile",
]

RETRYABLE_CODES = ("429", "503", "UNAVAILABLE", "RESOURCE_EXHAUSTED")
MAX_RETRIES_PER_MODEL = 3

# Una sola llamada HTTP a la vez: evita colgar el chat con validación + recovery + background
_llm_generate_lock = asyncio.Lock()


class LLMService:
    """Proveedor unificado de LLM: Gemini (preferido) u OpenAI."""

    def __init__(self):
        from app.core.config import Settings
        cfg = Settings()
        self.provider = cfg.LLM_PROVIDER.lower()
        self._gemini_client = None
        self._openai_client = None

        if self.provider == "openai" and cfg.OPENAI_API_KEY and OPENAI_AVAILABLE:
            openai_kwargs = {"api_key": cfg.OPENAI_API_KEY}
            if cfg.OPENAI_BASE_URL.strip():
                openai_kwargs["base_url"] = cfg.OPENAI_BASE_URL.strip()
            self._openai_client = AsyncOpenAI(**openai_kwargs)
            self.provider = "openai"
        elif self.provider == "gemini" and cfg.GEMINI_API_KEY and GEMINI_AVAILABLE:
            self._gemini_client = genai.Client(api_key=cfg.GEMINI_API_KEY)
        elif cfg.OPENAI_API_KEY and OPENAI_AVAILABLE:
            openai_kwargs = {"api_key": cfg.OPENAI_API_KEY}
            if cfg.OPENAI_BASE_URL.strip():
                openai_kwargs["base_url"] = cfg.OPENAI_BASE_URL.strip()
            self._openai_client = AsyncOpenAI(**openai_kwargs)
            self.provider = "openai"
        elif cfg.GEMINI_API_KEY and GEMINI_AVAILABLE:
            self._gemini_client = genai.Client(api_key=cfg.GEMINI_API_KEY)
            self.provider = "gemini"

        self._cfg = cfg

    @property
    def is_configured(self) -> bool:
        return self._gemini_client is not None or self._openai_client is not None

    async def generate(
        self,
        system: str,
        user: str,
        json_mode: bool = True,
        temperature: float = 0.2,
        *,
        single_shot: bool = False,
    ) -> str:
        """Una generación. Con single_shot=True: 1 modelo, 1 intento (chat por turno)."""
        if not self.is_configured:
            raise RuntimeError(
                "No hay API key configurada. Agrega GEMINI_API_KEY o OPENAI_API_KEY en backend/.env"
            )

        from app.services.prompt_utils import cap_llm_prompts
        system, user = cap_llm_prompts(system, user)

        async with _llm_generate_lock:
            if self._gemini_client:
                return await self._generate_gemini(
                    system, user, json_mode, temperature, single_shot=single_shot,
                )
            return await self._generate_openai(
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
            max_retries = 1
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
                    if (
                        not single_shot
                        and ("403" in err_str or "PERMISSION_DENIED" in err_str)
                        and self._openai_client
                    ):
                        return await self._generate_openai(
                            system, user, json_mode, temperature, single_shot=False,
                        )
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
                "Cuota de Gemini agotada o no disponible en el plan gratuito. "
                "Espera unos minutos, habilita facturación en Google AI Studio, "
                "o genera una nueva API key en https://aistudio.google.com/apikey"
            )
        if "503" in err or "UNAVAILABLE" in err:
            return (
                "Gemini tiene alta demanda temporal. El sistema reintentó con otros modelos. "
                "Espera unos segundos e intenta de nuevo."
            )
        if "401" in err or "UNAUTHENTICATED" in err:
            return "API key de Gemini inválida. Verifica GEMINI_API_KEY en backend/.env"
        if "403" in err or "PERMISSION_DENIED" in err:
            if "denied access" in google_msg.lower():
                return (
                    "Google bloqueó el acceso a Gemini para tu cuenta/proyecto "
                    f"({google_msg}). "
                    "Ninguna API key de esa cuenta funcionará hasta que Google lo desbloquee. "
                    "Opciones: (1) usar otra cuenta de Google en AI Studio, "
                    "(2) contactar soporte de Google Cloud, "
                    "(3) cambiar a OpenAI/Groq en backend/.env: "
                    "LLM_PROVIDER=openai, OPENAI_API_KEY=tu_key "
                    "(Groq gratis: OPENAI_BASE_URL=https://api.groq.com/openai/v1, "
                    "OPENAI_MODEL=llama-3.3-70b-versatile)."
                )
            return (
                "Tu API key de Gemini fue rechazada (acceso denegado al proyecto de Google). "
                f"Detalle de Google: {google_msg}. "
                "Genera una nueva key en https://aistudio.google.com/apikey con otra cuenta o proyecto, "
                "actualiza GEMINI_API_KEY en backend/.env y reinicia el backend. "
                "Alternativa: configura OPENAI_API_KEY y LLM_PROVIDER=openai en backend/.env"
            )
        return f"Error de Gemini: {google_msg}"

    async def test_connection(self) -> dict:
        if not self.is_configured:
            return {
                "ok": False,
                "provider": self.provider,
                "error": "No hay API key configurada (GEMINI_API_KEY u OPENAI_API_KEY).",
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
                "provider": self.provider,
                "model": self._cfg.GEMINI_MODEL if self.provider == "gemini" else self._cfg.OPENAI_MODEL,
                "sample": (text or "").strip()[:80],
            }
        except LLMError as e:
            return {"ok": False, "provider": self.provider, "error": e.message}
        except Exception as e:
            return {"ok": False, "provider": self.provider, "error": str(e)[:300]}

    async def _generate_openai(
        self,
        system: str,
        user: str,
        json_mode: bool,
        temperature: float,
        *,
        single_shot: bool = False,
    ) -> str:
        if single_shot:
            models = [self._cfg.OPENAI_MODEL]
            max_retries = 1
        else:
            models = [self._cfg.OPENAI_MODEL] + [
                m for m in GROQ_FALLBACK_MODELS if m != self._cfg.OPENAI_MODEL
            ]
            max_retries = MAX_RETRIES_PER_MODEL
        last_err: Exception | None = None

        for model in models:
            kwargs = {
                "model": model,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                "temperature": temperature,
            }
            if json_mode:
                kwargs["response_format"] = {"type": "json_object"}

            for attempt in range(max_retries):
                try:
                    response = await self._openai_client.chat.completions.create(**kwargs)
                    return response.choices[0].message.content or ""
                except Exception as e:
                    last_err = e
                    err = str(e).lower()
                    if any(code in err for code in ("429", "rate_limit", "503", "timeout", "temporar")):
                        if attempt < max_retries - 1:
                            await asyncio.sleep(0.6 * (attempt + 1))
                            continue
                        break
                    if "413" in err or "too large" in err or "tokens" in err:
                        break  # probar siguiente modelo
                    raise LLMError(
                        "Error del proveedor de IA (Groq/OpenAI). Espera unos segundos e intenta de nuevo. "
                        "Si persiste, revisa OPENAI_API_KEY y OPENAI_BASE_URL en Render.",
                        502,
                    ) from e

        raise LLMError(
            "La solicitud supera el límite del proveedor o hay demasiada demanda. "
            "Intenta de nuevo en unos segundos con una respuesta más breve.",
            429,
        ) from last_err

    async def embed(self, text: str) -> list[float]:
        if not self.is_configured:
            return [0.0] * 8

        if self._gemini_client:
            def _call():
                return self._gemini_client.models.embed_content(
                    model=self._cfg.GEMINI_EMBEDDING_MODEL,
                    contents=text,
                )

            result = await asyncio.to_thread(_call)
            if result.embeddings:
                return list(result.embeddings[0].values)
            return [0.0] * 8

        if self._openai_client:
            response = await self._openai_client.embeddings.create(
                model=self._cfg.OPENAI_EMBEDDING_MODEL,
                input=text,
            )
            return response.data[0].embedding

        return [0.0] * 8
