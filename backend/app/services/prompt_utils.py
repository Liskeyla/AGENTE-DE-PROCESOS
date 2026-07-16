"""Utilidades para limitar tamaño de prompts (límites TPM de Groq)."""

from __future__ import annotations

import json
from typing import Any

# Groq llama-3.3-70b: ~12k tokens/request → contexto más chico para estabilidad
MAX_PROMPT_USER_CHARS = 4500
MAX_PROMPT_SYSTEM_CHARS = 1200
MAX_CHAT_MSG_CHARS = 280
MAX_CHAT_HISTORY_MSGS = 6


def as_list(value: Any) -> list:
    """Normaliza valores del LLM/JSON a lista (evita TypeError: unhashable type: 'slice')."""
    if value is None:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, tuple):
        return list(value)
    if isinstance(value, dict):
        # Preferir valores si parecen registros; si no, usar keys solo como último recurso
        vals = list(value.values())
        if vals and all(isinstance(v, (dict, str, int, float, bool)) or v is None for v in vals):
            return vals
        return list(value.items())
    return [value]


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
    if isinstance(g, dict):
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
        items = as_list(ks.get(key))
        if items:
            preview = ", ".join(str(x)[:80] for x in items[:8])
            lines.append(f"{label}: {preview}")

    ctx = ks.get("context") or {}
    if isinstance(ctx, dict):
        internal = as_list(ctx.get("internal"))
        external = as_list(ctx.get("external"))
        if internal:
            lines.append(f"Contexto interno: {', '.join(str(x) for x in internal[:5])}")
        if external:
            lines.append(f"Contexto externo: {', '.join(str(x) for x in external[:5])}")

    org = ks.get("organizational_structure") or {}
    if isinstance(org, dict):
        roles = as_list(org.get("roles"))
        if roles:
            lines.append("Cargos: " + ", ".join(
                (r.get("title", r) if isinstance(r, dict) else str(r))[:60] for r in roles[:8]
            ))

    processes = as_list(ks.get("processes"))
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

    risks = as_list(ks.get("risks_opportunities"))
    if risks:
        lines.append(f"Riesgos/oportunidades: {len(risks)} registrados")
    objectives = as_list(ks.get("quality_objectives"))
    if objectives:
        lines.append(f"Objetivos calidad: {len(objectives)}")
    indicators = as_list(ks.get("indicators"))
    if indicators:
        lines.append(f"Indicadores: {len(indicators)}")

    pending = as_list(ks.get("pending_information"))
    if pending:
        lines.append("Pendiente: " + "; ".join(str(p) for p in pending[:6]))

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
