"""Utilidades para limitar tamaño de prompts (límites TPM de Groq)."""

from __future__ import annotations

import json
from typing import Any

# Groq llama-3.3-70b: ~12k tokens/request → ~6k chars user de forma conservadora
MAX_PROMPT_USER_CHARS = 6000
MAX_PROMPT_SYSTEM_CHARS = 1500
MAX_CHAT_MSG_CHARS = 350
MAX_CHAT_HISTORY_MSGS = 10


def truncate_text(text: str, max_chars: int, suffix: str = "\n...[contenido truncado]") -> str:
    if not text or len(text) <= max_chars:
        return text or ""
    return text[: max_chars - len(suffix)] + suffix


def format_knowledge_compact(state: dict | None, max_chars: int = 3500) -> str:
    """Resumen compacto del estado interno (menos tokens que JSON completo)."""
    if not state:
        return "Sin datos estructurados aún."
    ks = state
    lines: list[str] = []
    g = ks.get("general") or {}
    if g.get("name"):
        lines.append(f"Organización: {g['name']}")
    if g.get("economic_activity"):
        lines.append(f"Actividad: {g['economic_activity']}")
    if g.get("size"):
        lines.append(f"Tamaño: {g['size']}")
    if g.get("mission"):
        lines.append(f"Misión: {g['mission']}")
    if g.get("vision"):
        lines.append(f"Visión: {g['vision']}")

    for label, key in (
        ("Productos/servicios", "products_services"),
        ("Clientes", "clients"),
        ("Proveedores", "suppliers"),
        ("Partes interesadas", "stakeholders"),
    ):
        items = ks.get(key) or []
        if items:
            preview = ", ".join(str(x)[:80] for x in items[:8])
            lines.append(f"{label}: {preview}")

    ctx = ks.get("context") or {}
    if ctx.get("internal"):
        lines.append(f"Contexto interno: {', '.join(str(x) for x in ctx['internal'][:5])}")
    if ctx.get("external"):
        lines.append(f"Contexto externo: {', '.join(str(x) for x in ctx['external'][:5])}")

    org = ks.get("organizational_structure") or {}
    roles = org.get("roles") or []
    if roles:
        lines.append("Cargos: " + ", ".join(
            (r.get("title", r) if isinstance(r, dict) else str(r))[:60] for r in roles[:8]
        ))

    processes = ks.get("processes") or []
    if processes:
        proc_lines = []
        for p in processes[:12]:
            if isinstance(p, dict):
                proc_lines.append(
                    f"{p.get('name', '?')} ({p.get('type', 'sin tipo')})"
                )
            else:
                proc_lines.append(str(p)[:60])
        lines.append("Procesos: " + "; ".join(proc_lines))

    if ks.get("risks_opportunities"):
        lines.append(f"Riesgos/oportunidades: {len(ks['risks_opportunities'])} registrados")
    if ks.get("quality_objectives"):
        lines.append(f"Objetivos calidad: {len(ks['quality_objectives'])}")
    if ks.get("indicators"):
        lines.append(f"Indicadores: {len(ks['indicators'])}")

    pending = ks.get("pending_information") or []
    if pending:
        lines.append("Pendiente: " + "; ".join(pending[:6]))

    return truncate_text("\n".join(lines), max_chars)


def format_iso_requirements_compact(data: dict) -> str:
    """Lista compacta id + título (sin temas extensos)."""
    lines = []
    for clause in data.get("clauses", []):
        lines.append(f"Cl.{clause['id']}: {clause['title']}")
        for req in clause.get("requirements", []):
            lines.append(f"  {req['id']} {req['title']}")
    return truncate_text("\n".join(lines), 4000)


def cap_llm_prompts(system: str, user: str) -> tuple[str, str]:
    return (
        truncate_text(system, MAX_PROMPT_SYSTEM_CHARS),
        truncate_text(user, MAX_PROMPT_USER_CHARS),
    )
