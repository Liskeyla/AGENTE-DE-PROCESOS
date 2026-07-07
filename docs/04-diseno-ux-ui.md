# Diseño UX/UI — Agente de Procesos BPMN

## Principios de Diseño

1. **Conversación primero**: Interfaz tipo ChatGPT como punto de entrada principal
2. **Progreso visible**: El usuario siempre sabe en qué fase está el análisis
3. **Contexto rico**: Documentos, diagramas y análisis accesibles desde el chat
4. **No abrumar**: Preguntas en lotes pequeños, información progresiva
5. **Profesional**: Estética empresarial, limpia, confiable

## Paleta de Colores

| Token | Valor | Uso |
|-------|-------|-----|
| `--primary` | #1E40AF (Blue 800) | Acciones principales, header |
| `--primary-light` | #3B82F6 (Blue 500) | Links, highlights |
| `--secondary` | #0F766E (Teal 700) | BPMN, diagramas |
| `--accent` | #F59E0B (Amber 500) | Alertas, preguntas pendientes |
| `--success` | #059669 (Emerald 600) | Completado, validado |
| `--danger` | #DC2626 (Red 600) | Riesgos, errores |
| `--background` | #F8FAFC (Slate 50) | Fondo general |
| `--surface` | #FFFFFF | Cards, paneles |
| `--text` | #0F172A (Slate 900) | Texto principal |
| `--text-muted` | #64748B (Slate 500) | Texto secundario |

## Layout Principal

```
┌──────────────────────────────────────────────────────────────────────┐
│  🏢 Agente de Procesos          [Proyecto: Gestión Solicitudes ▼]   │
│                                        [👤 Usuario] [⚙️] [🔔]       │
├──────────┬───────────────────────────────────────┬───────────────────┤
│          │                                       │                   │
│ SIDEBAR  │           ÁREA PRINCIPAL              │   PANEL LATERAL   │
│          │                                       │                   │
│ 📁 Docs  │  ┌─────────────────────────────┐   │  📊 Dashboard     │
│ 💬 Chat  │  │                             │   │  ─────────────    │
│ 📐 BPMN  │  │     CHAT / VIEWER ACTIVO    │   │  Actividades: 24  │
│ 📋 Análisis│  │                             │   │  Manuales: 12    │
│ ⚙️ Config │  │                             │   │  Auto: 5         │
│          │  └─────────────────────────────┘   │  Riesgos: 3       │
│          │                                       │  Preguntas: 4     │
│ ──────── │  ┌─────────────────────────────┐   │                   │
│ Fases:   │  │ 📎 Adjuntar  [Escribe...] ➤│   │  🔄 Fase actual:  │
│ ✅ Ingesta│  └─────────────────────────────┘   │  Preguntas        │
│ ✅ Extraer│                                       │  ████████░░ 80%  │
│ ✅ Consol.│                                       │                   │
│ 🔄 Pregunt.│                                      │                   │
│ ○ Modelar │                                       │                   │
│ ○ Analizar│                                       │                   │
└──────────┴───────────────────────────────────────┴───────────────────┘
```

## Pantallas Principales

### 1. Login / Registro
- Formulario centrado, logo corporativo
- Email + contraseña
- "Recordar sesión"
- Fondo con patrón sutil de diagramas BPMN

### 2. Dashboard de Proyectos
```
┌─────────────────────────────────────────────────┐
│  Mis Proyectos de Procesos          [+ Nuevo]  │
├─────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐            │
│  │ 📋 Gestión   │  │ 📋 Compras   │            │
│  │ Solicitudes  │  │ Internas     │            │
│  │              │  │              │            │
│  │ 🔄 Preguntas │  │ ✅ Completo  │            │
│  │ 4 docs       │  │ 8 docs       │            │
│  │ 80% progreso │  │ 100%         │            │
│  └──────────────┘  └──────────────┘            │
└─────────────────────────────────────────────────┘
```

### 3. Vista Chat (Principal)

**Mensajes del agente con tipos visuales:**

| Tipo | Icono | Estilo |
|------|-------|--------|
| Texto normal | 🤖 | Burbuja gris claro |
| Pregunta | ❓ | Burbuja amber con botones Sí/No/Detallar |
| Extracción | 📄 | Card expandible con entidades |
| BPMN listo | 📐 | Preview miniatura + "Ver diagrama" |
| Análisis | 📊 | Card con métricas resumidas |
| Error | ⚠️ | Burbuja roja |

**Ejemplo de interacción:**
```
🤖 He analizado 4 documentos del proceso "Gestión de Solicitudes".
   Identifiqué 24 actividades, 5 áreas y 3 sistemas.
   
   📊 Resumen de extracción                    [Expandir ▼]
   
❓ Pregunta 1 de 4 (Responsabilidades):
   "Se identifica que Operaciones aprueba la solicitud 
    antes de enviarla a Calidad. ¿Existe algún sistema 
    donde se registre esta aprobación?"
   
   [Sí, en SAP] [No, es manual] [Explicar más...]

👤 Sí, se registra en SAP con código de aprobación.

🤖 Perfecto. Registraré "Aprobación en SAP" como 
   service task automatizado en el diagrama.
```

### 4. Vista Documentos
- Lista de documentos cargados con estado
- Drag & drop para subir nuevos
- Preview del texto extraído
- Tags: área, participantes, tipo
- Indicador de procesamiento (spinner → check)

### 5. Vista BPMN
```
┌─────────────────────────────────────────────────┐
│  Diagramas BPMN                                 │
│  [Macro ▼] [Detallado: Operaciones ▼]          │
│                                                 │
│  ┌─────────────────────────────────────────┐   │
│  │                                         │   │
│  │         VISOR BPMN (bpmn-js)           │   │
│  │         Zoom / Pan / Fit               │   │
│  │                                         │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
│  [AS-IS] [TO-BE]  │  Exportar: [BPMN][SVG][PNG]│
└─────────────────────────────────────────────────┘
```

### 6. Vista Análisis
- Tabs: AS-IS | TO-BE | DMAIC | Lean | ISO | Madurez
- Cards con problemas, riesgos, oportunidades
- Gráficos: actividades manuales vs auto, tiempos, desperdicios
- Lista priorizada de recomendaciones

### 7. Dashboard Métricas (Panel lateral + página completa)
```
┌─────────────────────────────────────┐
│  Métricas del Proceso               │
├─────────────────────────────────────┤
│  Actividades totales        24      │
│  ████████████████████░░░░           │
│                                     │
│  Manuales              12 (50%)     │
│  Automatizables         8 (33%)     │
│  Automatizadas          4 (17%)     │
│                                     │
│  Riesgos identificados    3         │
│  🔴 Alto: 1  🟡 Medio: 2           │
│                                     │
│  Cumplimiento ISO 9001   72%       │
│  Madurez BPM            Nivel 2    │
│                                     │
│  Preguntas pendientes     4         │
│  Completitud              80%       │
└─────────────────────────────────────┘
```

## Componentes UI (shadcn/ui)

| Componente | Uso |
|-----------|-----|
| `ChatMessage` | Burbujas de chat con variantes |
| `QuestionCard` | Pregunta con opciones de respuesta |
| `DocumentUploader` | Drag & drop multi-archivo |
| `DocumentCard` | Card de documento con metadata |
| `BpmnViewer` | Wrapper de bpmn-js |
| `PhaseProgress` | Stepper de fases del agente |
| `MetricsCard` | Card de métrica con icono |
| `AnalysisPanel` | Panel AS-IS/TO-BE |
| `RecommendationList` | Lista priorizada |
| `ProjectCard` | Card de proyecto en dashboard |

## Responsive

- **Desktop (>1280px)**: Layout 3 columnas (sidebar + main + panel)
- **Tablet (768-1280px)**: Sidebar colapsable, panel como drawer
- **Mobile (<768px)**: Navegación bottom tab, chat full screen

## Microinteracciones

- Typing indicator cuando el agente procesa
- Progress bar animada en fases
- Confetti sutil al completar análisis
- Smooth scroll en chat
- Skeleton loaders en carga de diagramas
- Toast notifications para acciones (documento cargado, diagrama exportado)

## Accesibilidad

- WCAG 2.1 AA compliance
- Navegación por teclado en chat
- Screen reader labels en diagramas
- Contraste mínimo 4.5:1
- Focus indicators visibles
