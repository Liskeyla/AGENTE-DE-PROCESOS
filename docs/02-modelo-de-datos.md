# Modelo de Datos — Agente de Procesos BPMN

## Diagrama Entidad-Relación

```
Organization ──< User
Organization ──< Project ──< Document
Project ──< ProcessModel ──< Activity
Project ──< ProcessModel ──< Gateway
Project ──< ProcessModel ──< Lane
Project ──< ProcessModel ──< Event
Project ──< BpmnDiagram
Project ──< ChatMessage
Project ──< AgentQuestion
Project ──< ProcessAnalysis
Project ──< AuditLog
Document ──< DocumentChunk
Activity ──< ActivityInput/Output
Activity ──< BusinessRule
```

## Entidades Principales

### Organization
| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | UUID PK | Identificador |
| name | VARCHAR(255) | Nombre empresa |
| settings | JSONB | Configuración org |
| created_at | TIMESTAMP | Fecha creación |

### User
| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | UUID PK | Identificador |
| organization_id | UUID FK | Organización |
| email | VARCHAR(255) UNIQUE | Email login |
| password_hash | VARCHAR(255) | Hash bcrypt |
| full_name | VARCHAR(255) | Nombre completo |
| role | ENUM | admin, analyst, viewer |
| is_active | BOOLEAN | Estado cuenta |
| created_at | TIMESTAMP | Fecha creación |

### Project
| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | UUID PK | Identificador |
| organization_id | UUID FK | Organización |
| name | VARCHAR(255) | Nombre del proceso |
| description | TEXT | Descripción |
| status | ENUM | draft, analyzing, questioning, modeling, completed |
| agent_state | ENUM | Estado máquina del agente |
| methodology | JSONB | ISO/BPM/Lean config |
| created_by | UUID FK → User | Creador |
| created_at | TIMESTAMP | Fecha creación |
| updated_at | TIMESTAMP | Última modificación |

### Document
| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | UUID PK | Identificador |
| project_id | UUID FK | Proyecto |
| filename | VARCHAR(500) | Nombre original |
| file_type | ENUM | pdf, docx, xlsx, txt, csv, audio, transcript |
| file_path | VARCHAR(1000) | Ruta storage |
| file_size | BIGINT | Tamaño bytes |
| source_type | ENUM | interview, meeting, acta, validation, other |
| area | VARCHAR(255) | Área relacionada |
| participants | JSONB | Lista participantes |
| extracted_text | TEXT | Texto completo extraído |
| metadata | JSONB | Metadata adicional |
| processing_status | ENUM | pending, processing, completed, failed |
| created_at | TIMESTAMP | Fecha carga |

### DocumentChunk
| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | UUID PK | Identificador |
| document_id | UUID FK | Documento origen |
| chunk_index | INT | Índice del chunk |
| content | TEXT | Contenido del chunk |
| embedding_id | VARCHAR(255) | ID en ChromaDB |
| metadata | JSONB | página, sección, tipo |

### ProcessModel
| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | UUID PK | Identificador |
| project_id | UUID FK | Proyecto |
| model_type | ENUM | macro, detailed, as_is, to_be |
| name | VARCHAR(255) | Nombre del diagrama |
| version | INT | Versión del modelo |
| parent_id | UUID FK → ProcessModel | Subproceso padre |
| model_data | JSONB | Modelo intermedio completo |
| confidence_score | FLOAT | Confianza IA (0-1) |
| created_at | TIMESTAMP | Fecha generación |

### Activity
| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | UUID PK | Identificador |
| process_model_id | UUID FK | Modelo |
| bpmn_id | VARCHAR(100) | ID BPMN |
| name | VARCHAR(500) | Nombre actividad |
| description | TEXT | Descripción |
| activity_type | ENUM | task, user_task, service_task, manual, subprocess, script |
| lane_id | UUID FK → Lane | Lane responsable |
| sequence_order | INT | Orden en flujo |
| is_manual | BOOLEAN | Actividad manual |
| is_automated | BOOLEAN | Automatizada |
| estimated_time_min | INT | Tiempo estimado minutos |
| systems | JSONB | Sistemas utilizados |
| documents_used | JSONB | Documentos del proceso |
| source_document_ids | JSONB | Docs fuente |
| waste_type | ENUM | lean waste (waiting, rework, etc.) |
| metadata | JSONB | Info adicional |

### Gateway
| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | UUID PK | Identificador |
| process_model_id | UUID FK | Modelo |
| bpmn_id | VARCHAR(100) | ID BPMN |
| name | VARCHAR(500) | Nombre/condición |
| gateway_type | ENUM | exclusive, parallel, inclusive, event_based |
| conditions | JSONB | Reglas de decisión |
| sequence_order | INT | Orden |

### Lane
| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | UUID PK | Identificador |
| process_model_id | UUID FK | Modelo |
| bpmn_id | VARCHAR(100) | ID BPMN |
| name | VARCHAR(255) | Nombre lane |
| lane_type | ENUM | area, role, system, external |
| responsible_area | VARCHAR(255) | Área organizacional |
| participants | JSONB | Personas/roles |

### Event
| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | UUID PK | Identificador |
| process_model_id | UUID FK | Modelo |
| bpmn_id | VARCHAR(100) | ID BPMN |
| name | VARCHAR(500) | Nombre evento |
| event_type | ENUM | start, end, intermediate |
| trigger | VARCHAR(500) | Disparador |

### SequenceFlow
| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | UUID PK | Identificador |
| process_model_id | UUID FK | Modelo |
| source_bpmn_id | VARCHAR(100) | Origen |
| target_bpmn_id | VARCHAR(100) | Destino |
| condition | VARCHAR(500) | Condición (gateways) |
| is_default | BOOLEAN | Flujo por defecto |

### BusinessRule
| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | UUID PK | Identificador |
| activity_id | UUID FK | Actividad |
| rule_type | ENUM | validation, approval, exception, sla |
| description | TEXT | Descripción regla |
| condition | TEXT | Condición lógica |
| action | TEXT | Acción al cumplirse |
| iso_reference | VARCHAR(100) | Referencia ISO |

### BpmnDiagram
| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | UUID PK | Identificador |
| project_id | UUID FK | Proyecto |
| process_model_id | UUID FK | Modelo origen |
| diagram_type | ENUM | macro, detailed, as_is, to_be |
| name | VARCHAR(255) | Nombre diagrama |
| bpmn_xml | TEXT | XML BPMN 2.0 |
| svg_content | TEXT | SVG renderizado |
| version | INT | Versión |
| created_at | TIMESTAMP | Fecha generación |

### AgentQuestion
| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | UUID PK | Identificador |
| project_id | UUID FK | Proyecto |
| category | ENUM | missing_info, business_rule, responsibility, system, exception, kpi, automation |
| priority | ENUM | critical, high, medium, low |
| question | TEXT | Pregunta generada |
| context | TEXT | Contexto de la pregunta |
| related_activity_id | UUID FK | Actividad relacionada |
| status | ENUM | pending, answered, skipped |
| answer | TEXT | Respuesta del usuario |
| answered_at | TIMESTAMP | Fecha respuesta |
| created_at | TIMESTAMP | Fecha generación |

### ChatMessage
| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | UUID PK | Identificador |
| project_id | UUID FK | Proyecto |
| role | ENUM | user, assistant, system |
| content | TEXT | Contenido mensaje |
| message_type | ENUM | text, question, extraction, bpmn, analysis |
| metadata | JSONB | Datos adicionales |
| created_at | TIMESTAMP | Fecha |

### ProcessAnalysis
| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | UUID PK | Identificador |
| project_id | UUID FK | Proyecto |
| analysis_type | ENUM | as_is, to_be, dmaic, lean, iso, maturity |
| content | JSONB | Resultado estructurado |
| recommendations | JSONB | Recomendaciones |
| kpis | JSONB | Indicadores propuestos |
| risks | JSONB | Riesgos identificados |
| automations | JSONB | Oportunidades automatización |
| created_at | TIMESTAMP | Fecha análisis |

### AuditLog
| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | UUID PK | Identificador |
| organization_id | UUID FK | Organización |
| user_id | UUID FK | Usuario |
| project_id | UUID FK | Proyecto (nullable) |
| action | VARCHAR(100) | Acción realizada |
| resource_type | VARCHAR(100) | Tipo recurso |
| resource_id | UUID | ID recurso |
| details | JSONB | Detalle acción |
| ip_address | VARCHAR(45) | IP origen |
| created_at | TIMESTAMP | Fecha |

## Modelo Intermedio JSON (ProcessModel.model_data)

```json
{
  "process": {
    "id": "proc_001",
    "name": "Gestión de Solicitudes",
    "type": "macro",
    "pools": [
      {
        "id": "pool_001",
        "name": "Proceso Solicitudes",
        "lanes": [
          {"id": "lane_001", "name": "Operaciones", "type": "area"},
          {"id": "lane_002", "name": "Calidad", "type": "area"},
          {"id": "lane_003", "name": "SAP", "type": "system"}
        ]
      }
    ],
    "elements": [
      {"id": "start_1", "type": "startEvent", "name": "Solicitud recibida", "lane": "lane_001"},
      {"id": "task_1", "type": "userTask", "name": "Revisar solicitud", "lane": "lane_001", "is_manual": true},
      {"id": "gw_1", "type": "exclusiveGateway", "name": "¿Aprobada?", "lane": "lane_001"},
      {"id": "task_2", "type": "serviceTask", "name": "Registrar en SAP", "lane": "lane_003", "is_automated": true},
      {"id": "end_1", "type": "endEvent", "name": "Proceso completado", "lane": "lane_002"}
    ],
    "flows": [
      {"id": "flow_1", "source": "start_1", "target": "task_1"},
      {"id": "flow_2", "source": "task_1", "target": "gw_1"},
      {"id": "flow_3", "source": "gw_1", "target": "task_2", "condition": "Aprobada"},
      {"id": "flow_4", "source": "gw_1", "target": "end_1", "condition": "Rechazada", "is_default": true}
    ],
    "inputs": ["Formulario solicitud", "Documentos soporte"],
    "outputs": ["Solicitud aprobada/rechazada", "Registro SAP"],
    "critical_points": ["Aprobación manual sin SLA"],
    "systems": ["SAP", "SharePoint"]
  }
}
```

## Índices Recomendados

```sql
CREATE INDEX idx_documents_project ON documents(project_id);
CREATE INDEX idx_chunks_document ON document_chunks(document_id);
CREATE INDEX idx_activities_model ON activities(process_model_id);
CREATE INDEX idx_questions_project_status ON agent_questions(project_id, status);
CREATE INDEX idx_chat_project ON chat_messages(project_id, created_at);
CREATE INDEX idx_audit_org_date ON audit_logs(organization_id, created_at);
```
