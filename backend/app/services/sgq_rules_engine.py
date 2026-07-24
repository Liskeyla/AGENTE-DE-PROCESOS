"""Motor de reglas: relaciona brechas ISO con componentes del SGQ a generar."""

from __future__ import annotations

from typing import Any

# Cada componente puede activarse por múltiples requisitos y estados de cumplimiento.
COMPONENT_RULES: dict[str, dict[str, Any]] = {
    "contexto_organizacion": {
        "title": "Contexto de la organización",
        "description": "Factores internos y externos que afectan al SGC (cláusula 4.1)",
        "trigger_requirements": ["4.1"],
        "trigger_statuses": ["no_cumple", "cumple_parcialmente"],
        "requires_any": True,
    },
    "alcance_sgc": {
        "title": "Alcance del Sistema de Gestión de Calidad",
        "description": "Delimitación del SGC, productos/servicios y exclusiones (cláusula 4.3)",
        "trigger_requirements": ["4.3"],
        "trigger_statuses": ["no_cumple", "cumple_parcialmente"],
        "requires_any": True,
    },
    "partes_interesadas": {
        "title": "Identificación de partes interesadas",
        "description": "Partes interesadas, necesidades y expectativas (cláusula 4.2)",
        "trigger_requirements": ["4.2"],
        "trigger_statuses": ["no_cumple", "cumple_parcialmente"],
        "requires_any": True,
    },
    "mapa_procesos": {
        "title": "Mapa de procesos",
        "description": "Identificación, clasificación e interrelación de procesos estratégicos, misionales y de apoyo",
        "trigger_requirements": ["4.4"],
        "trigger_statuses": ["no_cumple", "cumple_parcialmente"],
        "context_flags": ["has_process_map"],
        "context_false_triggers": True,
    },
    "caracterizacion_procesos": {
        "title": "Caracterización de procesos",
        "description": "Ficha de caracterización por cada proceso identificado",
        "trigger_requirements": ["4.4", "7.5"],
        "trigger_statuses": ["no_cumple", "cumple_parcialmente"],
        "requires_any": True,
    },
    "matriz_interaccion": {
        "title": "Interacción entre procesos",
        "description": "Relaciones entre procesos, transferencia de información y dependencias",
        "trigger_requirements": ["4.4"],
        "trigger_statuses": ["no_cumple", "cumple_parcialmente"],
    },
    "cumplimiento_legal": {
        "title": "Matriz de cumplimiento legal",
        "description": "Requisitos legales y reglamentarios aplicables y estado de cumplimiento",
        "trigger_requirements": ["6.1.3", "4.2"],
        "trigger_statuses": ["no_cumple", "cumple_parcialmente"],
        "requires_any": True,
    },
    "organigrama": {
        "title": "Organigrama funcional",
        "description": "Estructura organizacional, cargos y líneas de responsabilidad",
        "trigger_requirements": ["5.3", "4.4"],
        "trigger_statuses": ["no_cumple", "cumple_parcialmente"],
        "requires_any": True,
    },
    "politica_calidad": {
        "title": "Política de calidad",
        "description": "Política alineada con cláusula 5.2 de la norma",
        "trigger_requirements": ["5.2"],
        "trigger_statuses": ["no_cumple", "cumple_parcialmente"],
        "context_flags": ["has_quality_policy"],
        "context_false_triggers": True,
    },
    "objetivos_calidad": {
        "title": "Objetivos de calidad",
        "description": "Objetivos medibles alineados con la política de calidad (cláusula 6.2)",
        "trigger_requirements": ["6.2"],
        "trigger_statuses": ["no_cumple", "cumple_parcialmente"],
        "requires_any": True,
    },
    "procedimientos": {
        "title": "Procedimientos",
        "description": "Procedimientos documentados para procesos que requieren estandarización",
        "trigger_requirements": ["7.5", "8.1", "8.5", "8.7"],
        "trigger_statuses": ["no_cumple", "cumple_parcialmente"],
        "requires_any": True,
    },
    "diagrama_flujo": {
        "title": "Diagramas de flujo",
        "description": "Secuencia operativa de procesos sin flujo definido",
        "trigger_requirements": ["4.4", "8.1", "8.5"],
        "trigger_statuses": ["no_cumple", "cumple_parcialmente"],
        "requires_any": True,
    },
    "riesgos_oportunidades": {
        "title": "Matriz de riesgos y oportunidades",
        "description": "Metodología y registro de riesgos y oportunidades (cláusula 6.1)",
        "trigger_requirements": ["6.1", "4.4"],
        "trigger_statuses": ["no_cumple", "cumple_parcialmente"],
        "requires_any": True,
        "context_flags": ["has_risk_methodology"],
        "context_false_triggers": True,
    },
    "indicadores": {
        "title": "Indicadores de desempeño",
        "description": "Indicadores propuestos para procesos sin mecanismos de medición",
        "trigger_requirements": ["9.1", "6.2"],
        "trigger_statuses": ["no_cumple", "cumple_parcialmente"],
        "requires_any": True,
        "context_flags": ["has_indicators"],
        "context_false_triggers": True,
    },
    "registros_requeridos": {
        "title": "Registros requeridos",
        "description": "Registros obligatorios del SGC y su control (cláusula 7.5)",
        "trigger_requirements": ["7.5"],
        "trigger_statuses": ["no_cumple", "cumple_parcialmente"],
        "requires_any": True,
    },
}

DOCUMENT_SCHEMAS: dict[str, str] = {
    "contexto_organizacion": """{
  "organization_name": "nombre de la organización",
  "internal_context": [
    {"factor": "factor interno", "description": "descripción", "impact": "impacto en el SGC"}
  ],
  "external_context": [
    {"factor": "factor externo", "description": "descripción", "impact": "impacto en el SGC"}
  ],
  "monitoring_review": "cómo se monitorea y revisa el contexto (4.1)",
  "summary": "resumen del contexto organizacional"
}""",
    "alcance_sgc": """{
  "organization_name": "nombre de la organización",
  "scope_statement": "texto del alcance del SGC",
  "products_services": ["productos y servicios incluidos"],
  "locations": ["ubicaciones o sitios incluidos"],
  "exclusions": [{"clause": "cláusula excluida", "justification": "justificación"}],
  "boundaries": "límites del sistema de gestión",
  "applicability_notes": "notas de aplicabilidad"
}""",
    "partes_interesadas": """{
  "stakeholders": [
    {
      "name": "parte interesada",
      "type": "interna|externa",
      "needs": ["necesidades"],
      "expectations": ["expectativas"],
      "requirements": ["requisitos relevantes"],
      "monitoring_method": "cómo se monitorea"
    }
  ],
  "summary": "resumen de partes interesadas"
}""",
    "mapa_procesos": """{
  "processes": [
    {
      "name": "nombre del proceso",
      "type": "estrategico|misional|apoyo",
      "description": "descripción breve",
      "owner": "responsable o [Por definir]",
      "inputs": ["entradas"],
      "outputs": ["salidas"],
      "related_processes": ["procesos relacionados"],
      "requires_documentation": true/false
    }
  ],
  "summary": "resumen del mapa",
  "justification_note": "por qué se generó este documento"
}""",
    "caracterizacion_procesos": """{
  "characterizations": [
    {
      "process_name": "nombre",
      "objective": "objetivo del proceso",
      "scope": "alcance",
      "owner": "responsable",
      "suppliers": ["proveedores"],
      "inputs": ["entradas"],
      "main_activities": ["actividades principales"],
      "outputs": ["salidas"],
      "clients": ["clientes del proceso"],
      "resources": ["recursos"],
      "indicators": ["indicadores asociados o propuestos"],
      "risks": ["riesgos relacionados"],
      "linked_documents": ["documentos vinculados"]
    }
  ]
}""",
    "diagrama_flujo": """{
  "diagrams": [
    {
      "process_name": "nombre del proceso (TO BE)",
      "start_event": "disparador de inicio",
      "end_event": "resultado de fin",
      "activities": [
        {
          "id": "A1",
          "name": "actividad clara y concreta",
          "responsible": "rol o cargo (carril)",
          "type": "task|decision|system",
          "status_note": "Estado: PENDIENTE|APROBADO|… o vacío",
          "inputs": ["entrada"],
          "outputs": ["salida"]
        }
      ],
      "decisions": [
        {"after": "A1", "question": "¿condición?", "yes_to": "A2", "no_to": "A3", "yes_label": "Sí", "no_label": "No"}
      ],
      "sequence": ["A1", "A2", "A3"]
    }
  ],
  "completeness_percent": 0
}""",
    "matriz_interaccion": """{
  "interactions": [
    {
      "source_process": "proceso origen",
      "target_process": "proceso destino",
      "information_transferred": "información transferida",
      "shared_resources": ["recursos compartidos"],
      "dependency": "tipo de dependencia"
    }
  ]
}""",
    "politica_calidad": """{
  "policy_text": "texto completo de la política de calidad propuesta",
  "commitments": ["compromisos incluidos"],
  "alignment_with_context": "cómo se alinea con misión/visión/contexto",
  "communication_suggestions": ["formas de comunicar la política"]
}""",
    "riesgos_oportunidades": """{
  "entries": [
    {
      "related_process": "proceso",
      "risk": "descripción del riesgo",
      "opportunity": "oportunidad asociada o null",
      "cause": "causa",
      "consequence": "consecuencia",
      "probability": "alta|media|baja",
      "impact": "alta|media|baja",
      "risk_level": "alto|medio|bajo",
      "proposed_action": "acción propuesta",
      "responsible": "responsable sugerido"
    }
  ]
}""",
    "indicadores": """{
  "indicators": [
    {
      "process_name": "proceso",
      "name": "nombre del indicador",
      "objective": "objetivo de medición",
      "formula": "fórmula",
      "frequency": "frecuencia",
      "target": "meta propuesta",
      "responsible": "responsable",
      "data_source": "fuente de información"
    }
  ]
}""",
    "procedimientos": """{
  "procedures": [
    {
      "code": "PROC-001",
      "title": "título del procedimiento",
      "process_name": "proceso relacionado",
      "objective": "objetivo",
      "scope": "alcance",
      "responsibilities": [{"role": "cargo", "responsibility": "responsabilidad"}],
      "definitions": [{"term": "término", "definition": "definición"}],
      "activities": [{"step": 1, "description": "actividad", "responsible": "rol", "records": ["registros"]}],
      "records": ["registros del procedimiento"],
      "annexes": ["anexos sugeridos"],
      "references": ["referencias normativas o internas"]
    }
  ],
  "completeness_percent": 0
}""",
    "cumplimiento_legal": """{
  "requirements": [
    {
      "law_or_regulation": "ley o norma aplicable",
      "scope": "ámbito de aplicación",
      "requirement_summary": "requisito legal",
      "compliance_status": "cumple|no_cumple|parcial|por_verificar",
      "evidence": "evidencia o [Por definir]",
      "responsible": "responsable",
      "review_frequency": "frecuencia de revisión"
    }
  ],
  "summary": "resumen de cumplimiento legal"
}""",
    "objetivos_calidad": """{
  "objectives": [
    {
      "objective": "objetivo de calidad",
      "indicator": "indicador asociado",
      "target": "meta",
      "deadline": "plazo",
      "responsible": "responsable",
      "linked_process": "proceso relacionado",
      "resources": "recursos necesarios"
    }
  ],
  "alignment_with_policy": "alineación con la política de calidad"
}""",
    "registros_requeridos": """{
  "records": [
    {
      "code": "REG-001",
      "name": "nombre del registro",
      "related_clause": "cláusula ISO",
      "related_process": "proceso",
      "responsible": "responsable",
      "retention_period": "tiempo de conservación",
      "storage_location": "ubicación",
      "format": "formato"
    }
  ],
  "summary": "resumen de registros requeridos"
}""",
    "organigrama": """{
  "organization_name": "nombre de la organización",
  "nodes": [
    {
      "id": "n1",
      "title": "cargo",
      "name": "persona o [Por definir]",
      "level": 1,
      "parent_id": null,
      "area": "área o departamento",
      "responsibilities": ["responsabilidades principales"]
    }
  ],
  "summary": "descripción del organigrama propuesto TO BE",
  "completeness_percent": 0
}""",
}


def build_org_context_from_knowledge(knowledge_state: dict | None) -> dict:
    """Deriva flags de contexto desde el estado interno para el motor de reglas."""
    ks = knowledge_state or {}
    general = ks.get("general") or {}
    processes = ks.get("processes") or []
    documented = ks.get("documented_information") or []
    indicators = ks.get("indicators") or []

    has_processes = len(processes) > 0
    undocumented = any(
        isinstance(p, dict) and p.get("documented") is False for p in processes
    )
    documented_some = any(
        isinstance(p, dict) and p.get("documented") is True for p in processes
    ) or bool(documented)

    return {
        "mission": general.get("mission"),
        "vision": general.get("vision"),
        "products_services": ", ".join(ks.get("products_services") or []) or general.get("economic_activity"),
        "areas": [
            a.get("name", a) if isinstance(a, dict) else str(a)
            for a in (ks.get("organizational_structure") or {}).get("areas", [])
        ],
        "processes_mentioned": [
            p.get("name", p) if isinstance(p, dict) else str(p) for p in processes
        ],
        "has_documented_processes": documented_some if has_processes else None,
        "has_undocumented_processes": undocumented if has_processes else None,
        "has_process_map": ks.get("artifacts", {}).get("has_process_map") if isinstance(ks.get("artifacts"), dict) else None,
        "has_process_sequence_defined": any(
            isinstance(p, dict) and (p.get("activities") or p.get("sequence"))
            for p in processes
        ) if has_processes else None,
        "has_quality_policy": ks.get("artifacts", {}).get("has_quality_policy") if isinstance(ks.get("artifacts"), dict) else (
            False if has_processes and not general.get("mission") else None
        ),
        "has_risk_methodology": bool(ks.get("risks_opportunities")) or None,
        "has_indicators": bool(indicators) or None,
        "has_quality_objectives": bool(ks.get("quality_objectives")) or None,
        "has_legal_requirements": bool(ks.get("legal_requirements")) or None,
        "has_documented_information": bool(documented) or None,
        "has_stakeholders": bool(ks.get("stakeholders")) or None,
        "has_org_context": bool(ks.get("context")) or None,
        "processes_need_procedures": any(
            isinstance(p, dict) and p.get("requires_documentation") is not False
            for p in processes
        ) if has_processes else None,
        "process_approach_implemented": (
            has_processes and documented_some and not undocumented
        ) if has_processes else None,
    }


def _merge_context(llm_ctx: dict | None, knowledge_state: dict | None) -> dict:
    derived = build_org_context_from_knowledge(knowledge_state)
    merged = dict(derived)
    for key, value in (llm_ctx or {}).items():
        if value is not None:
            merged[key] = value
    return merged


def infer_proposed_components(
    evaluations: list[dict],
    gaps: list[dict],
    org_context: dict | None = None,
    knowledge_state: dict | None = None,
) -> list[dict]:
    """Determina qué componentes SGQ proponer según evaluaciones, brechas y contexto."""
    eval_by_req = {e["requirement_id"]: e for e in evaluations}
    gap_by_req = {g["requirement_id"]: g for g in gaps}
    ctx = _merge_context(org_context, knowledge_state)
    proposed: list[dict] = []
    proposed_ids: set[str] = set()

    def add_component(comp_id: str, related: list[str], extra_justification: str = "") -> None:
        if comp_id in proposed_ids or comp_id not in COMPONENT_RULES:
            return
        rule = COMPONENT_RULES[comp_id]
        gap_refs = [gap_by_req[r] for r in related if r in gap_by_req]
        justification_parts = []
        for g in gap_refs[:3]:
            justification_parts.append(
                f"Brecha en {g.get('requirement_id')} ({g.get('requirement_title', '')}): "
                f"{g.get('recommendation', g.get('evidence_missing', ''))}"
            )
        if extra_justification:
            justification_parts.append(extra_justification)
        proposed.append({
            "component_type": comp_id,
            "title": rule["title"],
            "description": rule["description"],
            "justification": " ".join(justification_parts) or rule["description"],
            "related_requirements": related,
            "related_gaps": [
                {
                    "requirement_id": g.get("requirement_id"),
                    "priority": g.get("priority"),
                    "recommendation": g.get("recommendation"),
                }
                for g in gap_refs
            ],
            "status": "pending",
        })
        proposed_ids.add(comp_id)

    # --- Reglas específicas del motor de inferencia documental ---
    process_approach = ctx.get("process_approach_implemented")
    if process_approach is False or ctx.get("has_process_map") is False:
        add_component(
            "mapa_procesos",
            [r for r in ("4.4",) if r in gap_by_req or eval_by_req.get(r, {}).get("status") != "cumple"],
            "La organización no posee un enfoque por procesos completamente implementado.",
        )

    if ctx.get("has_process_sequence_defined") is False and ctx.get("processes_mentioned"):
        add_component(
            "diagrama_flujo",
            [r for r in ("4.4", "8.1", "8.5") if r in gap_by_req or eval_by_req.get(r, {}).get("status") in ("no_cumple", "cumple_parcialmente")],
            "Procesos identificados sin secuencia operativa definida.",
        )

    if ctx.get("has_quality_policy") is False or eval_by_req.get("5.2", {}).get("status") in ("no_cumple", "cumple_parcialmente"):
        add_component(
            "politica_calidad",
            [r for r in ("5.2",) if r in gap_by_req or eval_by_req.get(r, {}).get("status") != "cumple"],
            "No dispone de Política de Calidad conforme a la cláusula 5.2.",
        )

    if ctx.get("has_indicators") is False and ctx.get("processes_mentioned"):
        add_component(
            "indicadores",
            [r for r in ("9.1", "6.2") if r in gap_by_req or eval_by_req.get(r, {}).get("status") in ("no_cumple", "cumple_parcialmente")],
            "Procesos sin mecanismos de medición de desempeño.",
        )

    if ctx.get("processes_need_procedures") is True or ctx.get("has_undocumented_processes") is True:
        add_component(
            "procedimientos",
            [r for r in ("7.5", "8.1", "8.5") if r in gap_by_req or eval_by_req.get(r, {}).get("status") in ("no_cumple", "cumple_parcialmente")],
            "Procesos que requieren estandarización documental.",
        )

    if ctx.get("has_org_context") is False or eval_by_req.get("4.1", {}).get("status") in ("no_cumple", "cumple_parcialmente"):
        add_component(
            "contexto_organizacion",
            [r for r in ("4.1",) if r in gap_by_req or eval_by_req.get(r, {}).get("status") in ("no_cumple", "cumple_parcialmente")],
            "Contexto organizacional no documentado conforme a la cláusula 4.1.",
        )

    if eval_by_req.get("4.3", {}).get("status") in ("no_cumple", "cumple_parcialmente"):
        add_component(
            "alcance_sgc",
            [r for r in ("4.3",) if r in gap_by_req or eval_by_req.get(r, {}).get("status") in ("no_cumple", "cumple_parcialmente")],
            "Alcance del SGC no definido o incompleto.",
        )

    if ctx.get("has_stakeholders") is False or eval_by_req.get("4.2", {}).get("status") in ("no_cumple", "cumple_parcialmente"):
        add_component(
            "partes_interesadas",
            [r for r in ("4.2",) if r in gap_by_req or eval_by_req.get(r, {}).get("status") in ("no_cumple", "cumple_parcialmente")],
            "Partes interesadas no identificadas o monitoreadas.",
        )

    if ctx.get("processes_mentioned") and eval_by_req.get("4.4", {}).get("status") in ("no_cumple", "cumple_parcialmente"):
        add_component(
            "caracterizacion_procesos",
            [r for r in ("4.4", "7.5") if r in gap_by_req or eval_by_req.get(r, {}).get("status") in ("no_cumple", "cumple_parcialmente")],
            "Procesos sin caracterización documentada.",
        )

    if ctx.get("has_legal_requirements") is False or eval_by_req.get("6.1.3", {}).get("status") in ("no_cumple", "cumple_parcialmente"):
        add_component(
            "cumplimiento_legal",
            [r for r in ("6.1.3",) if r in gap_by_req or eval_by_req.get(r, {}).get("status") in ("no_cumple", "cumple_parcialmente")],
            "Requisitos legales aplicables no identificados o sin seguimiento.",
        )

    if ctx.get("has_quality_objectives") is False or eval_by_req.get("6.2", {}).get("status") in ("no_cumple", "cumple_parcialmente"):
        add_component(
            "objetivos_calidad",
            [r for r in ("6.2",) if r in gap_by_req or eval_by_req.get(r, {}).get("status") in ("no_cumple", "cumple_parcialmente")],
            "Objetivos de calidad no definidos o no medibles.",
        )

    if ctx.get("has_documented_information") is False or eval_by_req.get("7.5", {}).get("status") in ("no_cumple", "cumple_parcialmente"):
        add_component(
            "registros_requeridos",
            [r for r in ("7.5",) if r in gap_by_req or eval_by_req.get(r, {}).get("status") in ("no_cumple", "cumple_parcialmente")],
            "Registros del SGC no identificados o sin control.",
        )

    # --- Reglas generales por requisitos y brechas ---
    for comp_id, rule in COMPONENT_RULES.items():
        triggered_reqs: list[str] = []
        triggered_gaps: list[dict] = []

        for req_id in rule.get("trigger_requirements", []):
            ev = eval_by_req.get(req_id)
            if ev and ev.get("status") in rule.get("trigger_statuses", []):
                triggered_reqs.append(req_id)
                if req_id in gap_by_req:
                    triggered_gaps.append(gap_by_req[req_id])

        context_trigger = False
        for flag in rule.get("context_flags", []):
            if rule.get("context_false_triggers") and ctx.get(flag) is False:
                context_trigger = True

        requires_any = rule.get("requires_any", False)
        req_trigger = bool(triggered_reqs) if requires_any else (
            len(triggered_reqs) == len(rule.get("trigger_requirements", []))
            and bool(triggered_reqs)
        )

        if not req_trigger and not context_trigger:
            continue

        if comp_id in proposed_ids:
            continue

        related = triggered_reqs or [
            r for r in rule.get("trigger_requirements", []) if r in gap_by_req
        ]
        gap_refs = triggered_gaps or [gap_by_req[r] for r in related if r in gap_by_req]

        justification_parts = []
        for g in gap_refs[:3]:
            justification_parts.append(
                f"Brecha en {g.get('requirement_id')} ({g.get('requirement_title', '')}): "
                f"{g.get('recommendation', g.get('evidence_missing', ''))}"
            )
        if context_trigger:
            justification_parts.append(
                f"El contexto organizacional indica ausencia de {rule['title'].lower()}"
            )

        proposed.append({
            "component_type": comp_id,
            "title": rule["title"],
            "description": rule["description"],
            "justification": " ".join(justification_parts) or rule["description"],
            "related_requirements": related,
            "related_gaps": [
                {
                    "requirement_id": g.get("requirement_id"),
                    "priority": g.get("priority"),
                    "recommendation": g.get("recommendation"),
                }
                for g in gap_refs
            ],
            "status": "pending",
        })
        proposed_ids.add(comp_id)

    return proposed


def build_compliance_summary(evaluations: list[dict]) -> dict:
    """Calcula resumen de cumplimiento por cláusula y general."""
    by_clause: dict[str, dict] = {}
    counts = {"cumple": 0, "cumple_parcialmente": 0, "no_cumple": 0}

    for ev in evaluations:
        clause = str(ev.get("clause", ev.get("requirement_id", "?")).split(".")[0])
        status = ev.get("status", "no_cumple")
        if status not in counts:
            status = "no_cumple"
        counts[status] += 1

        if clause not in by_clause:
            by_clause[clause] = {"total": 0, "score_sum": 0}
        by_clause[clause]["total"] += 1
        score = {"cumple": 100, "cumple_parcialmente": 50, "no_cumple": 0}.get(status, 0)
        by_clause[clause]["score_sum"] += score

    clause_percent: dict[str, float] = {}
    for clause, data in by_clause.items():
        clause_percent[clause] = round(data["score_sum"] / data["total"], 1) if data["total"] else 0

    total = len(evaluations) or 1
    overall = round(
        (counts["cumple"] * 100 + counts["cumple_parcialmente"] * 50) / total, 1
    )

    return {
        "overall_percent": overall,
        "by_clause": clause_percent,
        "cumple": counts["cumple"],
        "cumple_parcialmente": counts["cumple_parcialmente"],
        "no_cumple": counts["no_cumple"],
        "total_requirements": total,
    }
