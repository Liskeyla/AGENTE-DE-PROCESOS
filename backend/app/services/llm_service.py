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
    "gemini-2.5-flash",
    "gemini-2.0-flash-lite",
    "gemini-1.5-flash",
    "gemini-2.0-flash",
]


class LLMService:
    """Proveedor unificado de LLM: Gemini (preferido) u OpenAI."""

    def __init__(self):
        self.provider = settings.LLM_PROVIDER.lower()
        self._gemini_client = None
        self._openai_client = None

        if self.provider == "gemini" and settings.GEMINI_API_KEY and GEMINI_AVAILABLE:
            self._gemini_client = genai.Client(api_key=settings.GEMINI_API_KEY)
        elif settings.OPENAI_API_KEY and OPENAI_AVAILABLE:
            self._openai_client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
            self.provider = "openai"

    @property
    def is_configured(self) -> bool:
        return self._gemini_client is not None or self._openai_client is not None

    async def generate(
        self,
        system: str,
        user: str,
        json_mode: bool = True,
        temperature: float = 0.2,
    ) -> str:
        if not self.is_configured:
            raise RuntimeError(
                "No hay API key configurada. Agrega GEMINI_API_KEY o OPENAI_API_KEY en backend/.env"
            )

        if self._gemini_client:
            return await self._generate_gemini(system, user, json_mode, temperature)
        return await self._generate_openai(system, user, json_mode, temperature)

    async def _generate_gemini(
        self, system: str, user: str, json_mode: bool, temperature: float
    ) -> str:
        config_kwargs = {"temperature": temperature}
        if json_mode:
            config_kwargs["response_mime_type"] = "application/json"

        config = types.GenerateContentConfig(**config_kwargs)
        prompt = f"{system}\n\n---\n\n{user}"

        models_to_try = [settings.GEMINI_MODEL] + [
            m for m in FALLBACK_MODELS if m != settings.GEMINI_MODEL
        ]
        last_error = None

        for model in models_to_try:
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
                if "429" in err_str or "RESOURCE_EXHAUSTED" in err_str:
                    continue
                if "404" in err_str or "NOT_FOUND" in err_str:
                    continue
                raise LLMError(self._friendly_gemini_error(e), 502) from e
            except Exception as e:
                raise LLMError(f"Error al conectar con Gemini: {e}", 502) from e

        raise LLMError(self._friendly_gemini_error(last_error), 429)

    def _friendly_gemini_error(self, error: Exception | None) -> str:
        if error is None:
            return "Gemini no respondió. Verifica tu API key y cuota en Google AI Studio."
        err = str(error)
        if "429" in err or "RESOURCE_EXHAUSTED" in err or "quota" in err.lower():
            return (
                "Cuota de Gemini agotada o no disponible en el plan gratuito. "
                "Espera unos minutos, habilita facturación en Google AI Studio, "
                "o genera una nueva API key en https://aistudio.google.com/apikey"
            )
        if "401" in err or "UNAUTHENTICATED" in err:
            return "API key de Gemini inválida. Verifica GEMINI_API_KEY en backend/.env"
        return f"Error de Gemini: {err[:200]}"

    async def _generate_openai(
        self, system: str, user: str, json_mode: bool, temperature: float
    ) -> str:
        kwargs = {
            "model": settings.OPENAI_MODEL,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": temperature,
        }
        if json_mode:
            kwargs["response_format"] = {"type": "json_object"}

        response = await self._openai_client.chat.completions.create(**kwargs)
        return response.choices[0].message.content or ""

    async def embed(self, text: str) -> list[float]:
        if not self.is_configured:
            return [0.0] * 8

        if self._gemini_client:
            def _call():
                return self._gemini_client.models.embed_content(
                    model=settings.GEMINI_EMBEDDING_MODEL,
                    contents=text,
                )

            result = await asyncio.to_thread(_call)
            if result.embeddings:
                return list(result.embeddings[0].values)
            return [0.0] * 8

        if self._openai_client:
            response = await self._openai_client.embeddings.create(
                model=settings.OPENAI_EMBEDDING_MODEL,
                input=text,
            )
            return response.data[0].embedding

        return [0.0] * 8
