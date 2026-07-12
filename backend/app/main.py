from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.database import engine, Base, async_session
from app.api.router import api_router
import app.models  # noqa: F401 — registra modelos en Base.metadata


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    if settings.ENABLE_DEMO_USER:
        from app.core.seed import ensure_demo_user
        async with async_session() as session:
            await ensure_demo_user(session)
    yield
    await engine.dispose()


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="Agente de IA para levantamiento, análisis y documentación de procesos empresariales con BPMN 2.0",
    lifespan=lifespan,
)

_cors_kwargs: dict = {
    "allow_credentials": True,
    "allow_methods": ["*"],
    "allow_headers": ["*"],
}
if settings.DEBUG:
    # En desarrollo acepta cualquier puerto local (3000, 3001, etc.)
    _cors_kwargs["allow_origin_regex"] = r"https?://(localhost|127\.0\.0\.1)(:\d+)?"
else:
    _cors_kwargs["allow_origins"] = settings.CORS_ORIGINS
    # Previews y dominios personalizados de Vercel
    _cors_kwargs["allow_origin_regex"] = r"https://([\w-]+\.)?vercel\.app"

app.add_middleware(CORSMiddleware, **_cors_kwargs)

app.include_router(api_router)


@app.get("/health")
async def health():
    return {"status": "ok", "version": settings.APP_VERSION}


@app.get("/health/llm")
async def health_llm():
    from app.services.llm_service import LLMService
    return await LLMService().test_connection()
