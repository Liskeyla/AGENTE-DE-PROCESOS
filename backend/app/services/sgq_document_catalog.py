"""Catálogo ordenado de documentos SGQ ISO 9001:2015."""

from __future__ import annotations

# Orden oficial de presentación en la plataforma
PROGRESSIVE_DOC_TYPES: list[str] = [
    "contexto_organizacion",
    "alcance_sgc",
    "partes_interesadas",
    "mapa_procesos",
    "caracterizacion_procesos",
    "matriz_interaccion",
    "cumplimiento_legal",
    "organigrama",
    "politica_calidad",
    "objetivos_calidad",
    "procedimientos",
    "diagrama_flujo",
    "riesgos_oportunidades",
    "indicadores",
    "registros_requeridos",
]

DOC_PRIORITY = {doc_type: index for index, doc_type in enumerate(PROGRESSIVE_DOC_TYPES)}

# Máximo de borradores SGQ a regenerar por mensaje (evita bloquear el chat minutos)
PER_MESSAGE_MAX_DOC_UPDATES = 1

# Documentos iniciales al pasar de onboarding a entrevista ISO
ONBOARDING_BOOTSTRAP_DOCS = [
    "contexto_organizacion",
    "alcance_sgc",
    "partes_interesadas",
]

DOCUMENT_TITLES: dict[str, str] = {
    "contexto_organizacion": "Contexto de la organización",
    "alcance_sgc": "Alcance del Sistema de Gestión de Calidad",
    "partes_interesadas": "Identificación de partes interesadas",
    "mapa_procesos": "Mapa de procesos",
    "caracterizacion_procesos": "Caracterización de procesos",
    "matriz_interaccion": "Interacción entre procesos",
    "cumplimiento_legal": "Matriz de cumplimiento legal",
    "organigrama": "Organigrama funcional",
    "politica_calidad": "Política de calidad",
    "objetivos_calidad": "Objetivos de calidad",
    "procedimientos": "Procedimientos",
    "diagrama_flujo": "Diagramas de flujo",
    "riesgos_oportunidades": "Matriz de riesgos y oportunidades",
    "indicadores": "Indicadores de desempeño",
    "registros_requeridos": "Registros requeridos",
}
