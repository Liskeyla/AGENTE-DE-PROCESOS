# Despliegue en producción — Vercel + Render

Esta guía deja la aplicación accesible por URL pública conectando el repositorio Git.

## Arquitectura

| Componente | Plataforma | Qué despliega |
|------------|------------|---------------|
| **Frontend** (Next.js) | [Vercel](https://vercel.com) | Interfaz GeoCar SGQ |
| **Backend** (FastAPI) | [Render](https://render.com) | API REST + IA |
| **Base de datos** | Render PostgreSQL | Usuarios, proyectos, entrevistas |

> Vercel aloja el frontend. El backend Python requiere Render (o Railway/Fly.io) porque usa FastAPI, PostgreSQL y procesos largos de IA.

---

## Paso 1 — Subir el código a GitHub

```bash
git init
git add .
git commit -m "Preparar despliegue producción Vercel + Render"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/agente-procesos.git
git push -u origin main
```

No subas archivos `.env` con claves (ya están en `.gitignore`).

---

## Paso 2 — Desplegar el backend en Render

1. Entra en [dashboard.render.com](https://dashboard.render.com).
2. **New → Blueprint**.
3. Conecta el repositorio de GitHub.
4. Render detectará `render.yaml` y creará:
   - Base de datos PostgreSQL (`agente-procesos-db`)
   - Servicio web API (`agente-procesos-api`)
5. En el asistente, configura estas variables **obligatorias**:

| Variable | Ejemplo | Descripción |
|----------|---------|-------------|
| `GEMINI_API_KEY` | `AIza...` | API key de Google AI Studio (obligatoria) |
| `FRONTEND_URL` | *(la configurarás en el paso 3)* | URL de Vercel sin barra final |

6. Pulsa **Apply**. El primer deploy tarda ~5–10 minutos.
7. Cuando termine, copia la URL del API, por ejemplo:
   ```
   https://agente-procesos-api.onrender.com
   ```
8. Verifica salud: `https://TU-API.onrender.com/health` → `{"status":"ok"}`

**Usuario demo** (si `ENABLE_DEMO_USER=true`, activado por defecto en `render.yaml`):
- Email: `demo@empresa.com`
- Contraseña: `demo1234`

---

## Paso 3 — Desplegar el frontend en Vercel

1. Entra en [vercel.com](https://vercel.com) → **Add New → Project**.
2. Importa el mismo repositorio de GitHub.
3. Configura el proyecto:

| Campo | Valor |
|-------|--------|
| **Root Directory** | `frontend` |
| **Framework Preset** | Next.js |
| **Build Command** | `npm run build` |
| **Output Directory** | *(dejar por defecto)* |

4. En **Environment Variables**, añade:

| Nombre | Valor |
|--------|--------|
| `NEXT_PUBLIC_API_URL` | `https://agente-procesos-api.onrender.com/api/v1` |

*(Sustituye por tu URL real de Render + `/api/v1`)*

5. Pulsa **Deploy**. En ~2 minutos tendrás una URL como:
   ```
   https://agente-procesos.vercel.app
   ```

---

## Paso 4 — Enlazar frontend y backend (CORS)

1. Copia la URL final de Vercel (ej. `https://agente-procesos.vercel.app`).
2. En Render → servicio **agente-procesos-api** → **Environment**:
   - `FRONTEND_URL` = `https://agente-procesos.vercel.app`
   - Opcional: `CORS_ORIGINS` = `["https://agente-procesos.vercel.app"]`
3. **Save Changes** → Render redesplegará automáticamente.

El backend ya acepta dominios `*.vercel.app` en producción.

---

## Paso 5 — Probar en producción

1. Abre la URL de Vercel.
2. Inicia sesión con `demo@empresa.com` / `demo1234` o regístrate.
3. Crea un proyecto e inicia la entrevista ISO.

> **Nota:** El plan gratuito de Render “duerme” tras inactividad. La primera petición puede tardar 30–60 s (cold start).

---

## Variables de entorno — referencia

### Vercel (frontend)

```env
NEXT_PUBLIC_API_URL=https://TU-API.onrender.com/api/v1
```

### Render (backend)

```env
DEBUG=false
SECRET_KEY=<generado automáticamente>
DATABASE_URL=<desde PostgreSQL de Render>
LLM_PROVIDER=gemini
GEMINI_API_KEY=AIza...
GEMINI_MODEL=gemini-2.0-flash
FRONTEND_URL=https://tu-app.vercel.app
UPLOAD_DIR=/tmp/uploads
ENABLE_DEMO_USER=true
```

---

## Despliegues automáticos

Cada `git push` a `main`:
- **Vercel** redespliega el frontend automáticamente.
- **Render** redespliega el backend automáticamente.

---

## Solución de problemas

| Problema | Solución |
|----------|----------|
| "API no configurada" en el navegador | Define `NEXT_PUBLIC_API_URL` en Vercel y redespliega |
| Error CORS | Configura `FRONTEND_URL` en Render con la URL exacta de Vercel |
| API lenta al inicio | Cold start de Render free — espera y reintenta |
| Error 503 en chat | Revisa `GEMINI_API_KEY` en Render y `/health/llm` |
| Login falla tras deploy | Verifica que PostgreSQL esté vinculado y `/health` responda OK |

---

## Desarrollo local (sin cambios)

```powershell
.\scripts\start-dev.ps1
```

Frontend: `http://localhost:3002` · Backend: `http://localhost:8003`
