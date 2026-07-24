# Agente de Procesos BPMN

Agente de IA conversacional para levantamiento, análisis y documentación automática de procesos empresariales con generación de diagramas BPMN 2.0.

## Características

- **Carga multi-formato**: PDF, Word, Excel, TXT, CSV, transcripciones
- **Análisis con IA**: Extracción de actividades, responsables, sistemas, reglas de negocio
- **Consolidación multi-documento**: Merge, deduplicación y detección de contradicciones
- **Agente conversacional**: Preguntas inteligentes para completar información
- **Generación BPMN 2.0**: Diagramas macro y detallados exportables
- **Análisis AS-IS / TO-BE**: Lean, DMAIC, ISO, madurez BPM
- **Dashboard**: Métricas en tiempo real del proceso

## Stack

| Capa | Tecnología |
|------|-----------|
| Frontend | Next.js 14, TypeScript, Tailwind, bpmn-js |
| Backend | Python FastAPI, SQLAlchemy, LangChain |
| IA | Google Gemini |
| Base de datos | PostgreSQL |
| Vector DB | ChromaDB |
| BPMN | Generador propio → BPMN XML 2.0 |

## Inicio Rápido

### Prerrequisitos

- Docker y Docker Compose
- Google Gemini API Key (`GEMINI_API_KEY`)

### 1. Configurar variables de entorno

```bash
cp backend/.env.example backend/.env
# Editar backend/.env con tu GEMINI_API_KEY
```

### 2. Levantar con Docker

```bash
docker compose up -d
```

Servicios:
- Frontend: http://localhost:3000
- Backend API: http://localhost:8000
- API Docs: http://localhost:8000/docs
- PostgreSQL: localhost:5432
- ChromaDB: localhost:8001

### 3. Desarrollo local (sin Docker)

**Backend:**

```bash
cd backend
python -m venv venv
venv\Scripts\activate        # Windows
pip install -r requirements.txt
cp .env.example .env         # Configurar GEMINI_API_KEY
uvicorn app.main:app --reload --port 8000
```

**Frontend:**

```bash
cd frontend
npm install
npm run dev
```

**PostgreSQL y ChromaDB** deben estar corriendo (vía Docker o instalación local).

## Despliegue en producción (Vercel)

Para publicar la aplicación y compartirla por URL con usuarios reales:

📄 **[Guía completa: docs/DEPLOY-VERCEL.md](docs/DEPLOY-VERCEL.md)**

Resumen:
1. Sube el repo a **GitHub**
2. Despliega el **backend** en **Render** (usa `render.yaml`)
3. Despliega el **frontend** en **Vercel** (carpeta `frontend/`)
4. Configura `NEXT_PUBLIC_API_URL` en Vercel y `FRONTEND_URL` en Render

## Flujo de Uso

1. **Registrarse** en la plataforma
2. **Crear un proyecto** de proceso
3. **Cargar documentos** (entrevistas, actas, transcripciones)
4. **Presionar "Analizar"** — el agente extrae, consolida y genera preguntas
5. **Responder preguntas** en el chat
6. **Generar diagramas BPMN** (macro y detallados)
7. **Ejecutar análisis** AS-IS, TO-BE, Lean, DMAIC, ISO
8. **Exportar** diagramas en formato BPMN XML

## Estructura del Proyecto

```
├── docs/                    # Documentación de arquitectura
│   ├── 01-arquitectura-tecnica.md
│   ├── 02-modelo-de-datos.md
│   ├── 03-flujo-agente-ia.md
│   └── 04-diseno-ux-ui.md
├── backend/
│   ├── app/
│   │   ├── api/             # Endpoints REST
│   │   ├── core/            # Config, DB, seguridad
│   │   ├── models/          # Modelos SQLAlchemy
│   │   ├── schemas/         # Schemas Pydantic
│   │   ├── services/        # Lógica de negocio
│   │   │   ├── document_processor.py
│   │   │   ├── rag_service.py
│   │   │   ├── agent_orchestrator.py
│   │   │   └── bpmn_generator.py
│   │   └── prompts/         # Prompts del agente IA
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── app/             # Páginas Next.js
│   │   ├── components/      # Componentes React
│   │   └── lib/             # Cliente API
│   ├── package.json
│   └── Dockerfile
└── docker-compose.yml
```

## API Endpoints

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/api/v1/auth/register` | Registro |
| POST | `/api/v1/auth/login` | Login |
| POST | `/api/v1/projects` | Crear proyecto |
| POST | `/api/v1/projects/{id}/documents` | Subir documento |
| POST | `/api/v1/projects/{id}/analyze` | Iniciar análisis IA |
| POST | `/api/v1/projects/{id}/chat` | Chat conversacional |
| GET | `/api/v1/projects/{id}/questions` | Preguntas pendientes |
| POST | `/api/v1/projects/{id}/bpmn/generate` | Generar BPMN |
| GET | `/api/v1/projects/{id}/bpmn/{id}/export` | Exportar diagrama |
| POST | `/api/v1/projects/{id}/analysis/{type}` | Ejecutar análisis |
| GET | `/api/v1/projects/{id}/dashboard` | Métricas |

## Metodologías Aplicadas

- **BPM**: Ciclo completo de gestión de procesos
- **BPMN 2.0**: Notación estándar para diagramas
- **Lean Six Sigma**: DMAIC y 7 desperdicios
- **ISO**: 9001, 27001, 20000, 31000
- **Madurez BPM**: Evaluación nivel 1-5

## Seguridad

- Autenticación JWT
- Roles: Admin, Analyst, Viewer
- Aislamiento por organización y proyecto
- Cifrado de contraseñas (bcrypt)
- Auditoría de acciones

## Licencia

Uso interno empresarial.
