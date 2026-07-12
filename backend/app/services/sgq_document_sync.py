"""Sincroniza diagnóstico SGQ con borradores progresivos en sgq_documents."""

from __future__ import annotations

from app.services.sgq_document_catalog import PROGRESSIVE_DOC_TYPES
from app.services.sgq_rules_engine import COMPONENT_RULES


def document_has_content(doc: dict | None) -> bool:
    if not doc:
        return False
    pct = doc.get("completeness_percent") or 0
    if pct > 0:
        return True
    status = doc.get("status", "")
    if status and status not in ("pendiente", "pending"):
        return True
    content = doc.get("content") or {}
    if not isinstance(content, dict):
        return False
    for key in (
        "processes", "diagrams", "nodes", "procedures", "indicators",
        "interactions", "entries", "policy_text", "commitments",
        "characterizations", "stakeholders", "objectives", "requirements",
        "records", "documents", "internal_context", "external_context",
        "scope_statement",
    ):
        val = content.get(key)
        if isinstance(val, list) and len(val) > 0:
            return True
        if isinstance(val, str) and val.strip() and val.strip() != "Política en elaboración.":
            return True
    return False


def sync_proposed_components_with_documents(
    diagnosis: dict | None,
    documents: dict,
) -> list[dict]:
    """Alinea proposed_components del diagnóstico con los documentos reales del proyecto."""
    diagnosis = diagnosis or {}
    proposed_map = {
        c["component_type"]: dict(c)
        for c in diagnosis.get("proposed_components", [])
        if c.get("component_type")
    }
    merged: list[dict] = []

    for doc_type in PROGRESSIVE_DOC_TYPES:
        doc = documents.get(doc_type) or {}
        rule = COMPONENT_RULES.get(doc_type, {})
        entry = proposed_map.get(doc_type) or {
            "component_type": doc_type,
            "title": rule.get("title", doc_type.replace("_", " ").title()),
            "description": rule.get("description", ""),
            "justification": "Documento del SGQ en construcción con la información de la entrevista.",
            "related_requirements": list(rule.get("trigger_requirements", [])),
            "related_gaps": [],
            "status": "pending",
        }

        if document_has_content(doc):
            pct = int(doc.get("completeness_percent") or 0)
            entry["status"] = "generated" if pct >= 85 else "draft"
            entry["generated_at"] = doc.get("generated_at")
            entry["completeness_percent"] = pct
            if doc.get("title"):
                entry["title"] = doc["title"]
        else:
            entry.setdefault("status", "pending")
            entry["completeness_percent"] = 0

        merged.append(entry)

    return merged


def apply_document_sync_to_model_data(data: dict) -> dict:
    """Actualiza sgq_diagnosis.proposed_components según sgq_documents."""
    documents = data.get("sgq_documents") or {}
    diagnosis = data.get("sgq_diagnosis")
    if not documents and not diagnosis:
        return data
    if not diagnosis:
        diagnosis = {
            "diagnosed_at": None,
            "incremental": True,
            "compliance_summary": {},
            "requirements_evaluation": [],
            "gaps": [],
            "organization_context": {},
            "proposed_components": [],
        }
    diagnosis = dict(diagnosis)
    diagnosis["proposed_components"] = sync_proposed_components_with_documents(
        diagnosis, documents,
    )
    data = dict(data)
    data["sgq_diagnosis"] = diagnosis
    return data
