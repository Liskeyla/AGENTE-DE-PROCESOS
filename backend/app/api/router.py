from fastapi import APIRouter

from app.api import auth, projects, chat, sgq

api_router = APIRouter(prefix="/api/v1")

api_router.include_router(auth.router, prefix="/auth", tags=["Autenticación"])
api_router.include_router(projects.router, prefix="/projects", tags=["Proyectos"])
api_router.include_router(chat.router, prefix="/projects", tags=["Chat"])
api_router.include_router(sgq.router, prefix="/projects", tags=["SGQ"])
