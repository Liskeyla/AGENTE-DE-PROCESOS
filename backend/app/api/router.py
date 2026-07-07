from fastapi import APIRouter

from app.api import auth, projects, documents, chat, bpmn, analysis, dashboard, org_chart

api_router = APIRouter(prefix="/api/v1")

api_router.include_router(auth.router, prefix="/auth", tags=["Autenticación"])
api_router.include_router(projects.router, prefix="/projects", tags=["Proyectos"])
api_router.include_router(documents.router, prefix="/projects", tags=["Documentos"])
api_router.include_router(chat.router, prefix="/projects", tags=["Chat"])
api_router.include_router(bpmn.router, prefix="/projects", tags=["BPMN"])
api_router.include_router(analysis.router, prefix="/projects", tags=["Análisis"])
api_router.include_router(dashboard.router, prefix="/projects", tags=["Dashboard"])
api_router.include_router(org_chart.router, prefix="/projects", tags=["Organigrama"])
