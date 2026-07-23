from pydantic import field_validator
from pydantic_settings import BaseSettings
from typing import List
from pathlib import Path
import json
import os

_ENV_FILE = Path(__file__).resolve().parent.parent.parent / ".env"


def _normalize_database_url(url: str) -> str:
    """Convierte URLs de Postgres (Render, Neon, etc.) al driver asyncpg."""
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql+asyncpg://", 1)
    elif url.startswith("postgresql://") and "+asyncpg" not in url:
        url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url


class Settings(BaseSettings):
    APP_NAME: str = "Agente de Procesos BPMN"
    APP_VERSION: str = "1.0.2"
    DEBUG: bool = True
    SECRET_KEY: str = "change-this-to-a-secure-random-key"

    DATABASE_URL: str = "sqlite+aiosqlite:///./agente_procesos.db"

    # URL pública del frontend (Vercel) — se añade automáticamente a CORS
    FRONTEND_URL: str = ""

    # Crear usuario demo@empresa.com / demo1234 al iniciar (útil en producción)
    ENABLE_DEMO_USER: bool = False

    # Proveedor IA: gemini | openai
    LLM_PROVIDER: str = "gemini"
    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-2.0-flash-lite"
    GEMINI_EMBEDDING_MODEL: str = "text-embedding-004"

    OPENAI_API_KEY: str = ""
    OPENAI_BASE_URL: str = ""  # opcional: Groq, Azure, etc.
    OPENAI_MODEL: str = "gpt-4o"
    OPENAI_EMBEDDING_MODEL: str = "text-embedding-3-small"

    CHROMA_HOST: str = "localhost"
    CHROMA_PORT: int = 8001
    CHROMA_COLLECTION: str = "process_documents"

    UPLOAD_DIR: str = "./uploads"
    MAX_FILE_SIZE_MB: int = 50

    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    ALGORITHM: str = "HS256"

    CORS_ORIGINS: List[str] = [
        "http://localhost:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001",
    ]

    class Config:
        env_file = str(_ENV_FILE)
        extra = "ignore"

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def parse_cors_origins(cls, value):
        if value is None:
            return []
        if isinstance(value, list):
            return value
        if isinstance(value, str):
            raw = value.strip()
            if not raw:
                return []
            return json.loads(raw)
        return value

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.DATABASE_URL = _normalize_database_url(self.DATABASE_URL)
        if self.FRONTEND_URL and self.FRONTEND_URL.rstrip("/") not in self.CORS_ORIGINS:
            self.CORS_ORIGINS.append(self.FRONTEND_URL.rstrip("/"))
        # Vercel preview / production automático desde variable de entorno
        vercel_url = os.getenv("VERCEL_URL", "")
        if vercel_url:
            origin = vercel_url if vercel_url.startswith("http") else f"https://{vercel_url}"
            if origin.rstrip("/") not in self.CORS_ORIGINS:
                self.CORS_ORIGINS.append(origin.rstrip("/"))


settings = Settings()
