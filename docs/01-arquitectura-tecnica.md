# Arquitectura Técnica — Agente de Procesos BPMN

## 1. Visión General

Sistema modular de levantamiento, análisis y documentación automática de procesos empresariales con IA generativa, RAG documental y generación BPMN 2.0.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CAPA DE PRESENTACIÓN                              │
│  Next.js 14 (App Router) │ Chat UI │ Upload │ BPMN Viewer │ Dashboard     │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │ REST / WebSocket
┌──────────────────────────────────▼──────────────────────────────────────────┐
│                           API GATEWAY (FastAPI)                             │
│  Auth │ Projects │ Documents │ Chat │ Analysis │ BPMN │ Export │ Audit     │
└──────┬──────────────┬──────────────┬──────────────┬────────────────────────┘
       │              │              │              │
┌──────▼──────┐ ┌─────▼─────┐ ┌─────▼─────┐ ┌─────▼──────────────────────────┐
│ Document    │ │ RAG       │ │ Agent     │ │ BPMN Engine                    │
│ Processor   │ │ Service   │ │ Orchestr. │ │ Generator / Exporter           │
│ (LangChain) │ │ (Chroma)  │ │ (LLM)     │ │ (bpmn-moddle / bpmn-js)        │
└──────┬──────┘ └─────┬─────┘ └─────┬─────┘ └─────┬──────────────────────────┘
       │              │              │              │
┌──────▼──────────────▼──────────────▼──────────────▼────────────────────────┐
│                         CAPA DE PERSISTENCIA                                │
│  PostgreSQL (relacional) │ ChromaDB (vectores) │ MinIO/S3 (archivos)        │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 2. Stack Tecnológico

| Capa | Tecnología | Justificación |
|------|-----------|---------------|
| Frontend | Next.js 14, TypeScript, Tailwind, shadcn/ui | SSR, componentes modernos, chat fluido |
| BPMN Viewer | bpmn-js, bpmn-moddle | Estándar BPMN 2.0, compatible Visio/Draw.io |
| Backend | Python 3.11+, FastAPI, Pydantic v2 | Async, tipado, ecosistema IA |
| ORM | SQLAlchemy 2.0 + Alembic | Migraciones, modelo relacional robusto |
| IA / LLM | OpenAI / Azure OpenAI | Extracción, preguntas, generación BPMN |
| RAG | LangChain, ChromaDB | Consulta semántica sobre documentos |
| Documentos | python-docx, PyMuPDF, openpyxl, Whisper | PDF, Word, Excel, audio STT |
| Auth | JWT + bcrypt | Seguridad empresarial |
| Infra | Docker Compose | Desarrollo y despliegue reproducible |

## 3. Módulos del Sistema

### 3.1 Módulo de Ingesta Documental (`document_processor`)
- Extracción de texto por tipo de archivo
- Limpieza y normalización
- Chunking semántico con metadata (fuente, área, participante)
- Indexación en vector store

### 3.2 Módulo RAG (`rag_service`)
- Embeddings (text-embedding-3-small)
- Búsqueda híbrida: semántica + metadata filters
- Consolidación multi-documento
- Detección de duplicados y contradicciones

### 3.3 Módulo Agente IA (`agent_orchestrator`)
Pipeline de 7 fases alineado al ciclo BPM:

```
INGESTA → EXTRACCIÓN → CONSOLIDACIÓN → GAP ANALYSIS →
PREGUNTAS → MODELADO → MEJORA (AS-IS / TO-BE)
```

Estados del agente (máquina de estados):
- `IDLE` → `INGESTING` → `EXTRACTING` → `CONSOLIDATING`
- `QUESTIONING` → `MODELING` → `ANALYZING` → `COMPLETED`

### 3.4 Módulo BPMN (`bpmn_engine`)
- Modelo intermedio JSON (ProcessModel) → BPMN XML 2.0
- Soporte: Events, Tasks, Gateways, Pools, Lanes, Subprocesses
- Exportación: `.bpmn`, `.svg`, `.png`, Draw.io XML

### 3.5 Módulo de Análisis (`analysis_service`)
- AS-IS: cuellos de botella, desperdicios Lean, riesgos ISO
- TO-BE: automatizaciones, KPIs, controles
- DMAIC scoring
- Madurez BPM (nivel 1-5)

### 3.6 Módulo de Seguridad (`security`)
- JWT con refresh tokens
- RBAC: Admin, Analyst, Viewer
- Aislamiento por proyecto (multi-tenant)
- Auditoría de acciones

## 4. Flujo de Datos Principal

```
Usuario carga docs → Processor extrae texto → Chunks + Embeddings
       ↓
Agente extrae entidades (actividades, roles, sistemas, reglas)
       ↓
Consolidador une múltiples fuentes → elimina duplicados
       ↓
Gap Analyzer identifica información faltante
       ↓
Agente genera preguntas clasificadas → Usuario responde
       ↓
BPMN Generator crea diagrama MACRO + diagramas DETALLADOS
       ↓
Analysis Service genera AS-IS / TO-BE + recomendaciones
       ↓
Dashboard muestra métricas y diagramas exportables
```

## 5. APIs REST Principales

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/api/v1/auth/login` | Autenticación |
| POST | `/api/v1/projects` | Crear proyecto de proceso |
| POST | `/api/v1/projects/{id}/documents` | Subir documentos |
| POST | `/api/v1/projects/{id}/analyze` | Iniciar análisis IA |
| GET | `/api/v1/projects/{id}/extraction` | Resultado extracción |
| POST | `/api/v1/projects/{id}/chat` | Chat conversacional |
| GET | `/api/v1/projects/{id}/questions` | Preguntas pendientes |
| POST | `/api/v1/projects/{id}/questions/{qid}/answer` | Responder pregunta |
| POST | `/api/v1/projects/{id}/bpmn/generate` | Generar diagramas |
| GET | `/api/v1/projects/{id}/bpmn/{diagram_id}` | Obtener BPMN XML |
| GET | `/api/v1/projects/{id}/bpmn/{diagram_id}/export` | Exportar SVG/PNG/PDF |
| GET | `/api/v1/projects/{id}/analysis` | AS-IS / TO-BE |
| GET | `/api/v1/projects/{id}/dashboard` | Métricas del proyecto |

## 6. WebSocket (Chat en tiempo real)

```
ws://host/api/v1/projects/{id}/chat/stream
```

Eventos: `message`, `question`, `extraction_progress`, `bpmn_ready`, `error`

## 7. Despliegue

```yaml
# docker-compose.yml
services:
  postgres:     # Puerto 5432
  chromadb:     # Puerto 8001
  minio:        # Puerto 9000 (archivos)
  backend:      # Puerto 8000
  frontend:     # Puerto 3000
```

## 8. Escalabilidad

- **Horizontal**: Backend stateless detrás de load balancer
- **Vector DB**: ChromaDB → Pinecone en producción
- **Cola de tareas**: Celery + Redis para procesamiento pesado (OCR, STT)
- **Cache**: Redis para sesiones y resultados de análisis
- **Storage**: MinIO/S3 para archivos originales

## 9. Seguridad

- Cifrado TLS en tránsito
- Cifrado AES-256 en reposo (archivos)
- Secrets en variables de entorno / Azure Key Vault
- Rate limiting por usuario
- Logs de auditoría inmutables
- Separación de datos por `organization_id` + `project_id`

## 10. Integraciones Futuras

- Camunda / Flowable (ejecución BPMN)
- Microsoft Graph (Teams transcripts)
- SharePoint document ingestion
- Power BI (KPIs del dashboard)
- UiPath / Power Automate (RPA recommendations)
