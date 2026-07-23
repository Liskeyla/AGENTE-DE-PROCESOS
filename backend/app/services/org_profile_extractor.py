"""Extracción local de perfil organizacional (sin LLM)."""

from __future__ import annotations

import re
import unicodedata
from typing import Any


EMPLOYEE_SIZE_OPTIONS = [
    "Microempresa (1–10 colaboradores)",
    "Pequeña empresa (11–50 colaboradores)",
    "Mediana empresa (51–250 colaboradores)",
    "Gran empresa (más de 250 colaboradores)",
]

_FIELD_LABELS = {
    "org_name": "el nombre de la organización",
    "main_activity": "la actividad principal",
    "employee_size": "el tamaño o número de colaboradores",
}

_ACTIVITY_HINTS = (
    "distribuy", "comercializ", "fabric", "produc", "vend", "servici", "consultor",
    "transport", "logist", "import", "export", "desarroll", "constru",
    "aliment", "bebida", "limpieza", "salud", "educa", "tecnolog", "software",
    "actividad", "dedic", "ofrecemos", "nos dedicamos", "giro",
)


def _normalize(text: str) -> str:
    t = unicodedata.normalize("NFKC", (text or "").strip().lower())
    t = "".join(c for c in unicodedata.normalize("NFD", t) if unicodedata.category(c) != "Mn")
    t = re.sub(r"[^\w\s]", " ", t, flags=re.UNICODE)
    return re.sub(r"\s+", " ", t).strip()


def match_employee_size(text: str) -> str | None:
    raw = (text or "").strip()
    if not raw:
        return None
    lowered = raw.lower()
    for option in EMPLOYEE_SIZE_OPTIONS:
        if lowered == option.lower():
            return option

    normalized = _normalize(raw)
    if any(k in normalized for k in ("micro", "microempresa", "1 10", "1-10")):
        return EMPLOYEE_SIZE_OPTIONS[0]
    if any(k in normalized for k in ("pequena", "pyme", "11 50", "11-50")):
        return EMPLOYEE_SIZE_OPTIONS[1]
    if any(k in normalized for k in ("mediana", "51 250", "51-250")):
        return EMPLOYEE_SIZE_OPTIONS[2]
    if any(k in normalized for k in ("gran empresa", "grande", "mas de 250")):
        return EMPLOYEE_SIZE_OPTIONS[3]

    numbers = [int(n) for n in re.findall(r"\b(\d{1,5})\b", raw)]
    for n in numbers:
        if 1 <= n <= 10:
            return EMPLOYEE_SIZE_OPTIONS[0]
        if 11 <= n <= 50:
            return EMPLOYEE_SIZE_OPTIONS[1]
        if 51 <= n <= 250:
            return EMPLOYEE_SIZE_OPTIONS[2]
        if n > 250:
            return EMPLOYEE_SIZE_OPTIONS[3]
    return None


def _extract_org_name(text: str) -> str | None:
    cleaned = (text or "").strip()
    if not cleaned:
        return None

    m = re.search(
        r"(?:somos|nos llamamos|nuestra (?:empresa|organizaci[oó]n)(?: se llama)?|"
        r"el nombre(?: de la (?:empresa|organizaci[oó]n))? es|"
        r"organizaci[oó]n(?: llamada)?|empresa(?: llamada)?)\s*[:\-]?\s*"
        r"([A-ZÁÉÍÓÚÑ0-9][\wÁÉÍÓÚáéíóúñÑ\.\&\s]{1,80})",
        cleaned,
        re.I,
    )
    if m:
        name = m.group(1).strip(" .,;:")
        name = re.split(
            r"\b(?:que|y|con|dedicad[oa]s?|distribuy|comercializ|fabric|ofrec)\b",
            name,
            maxsplit=1,
            flags=re.I,
        )[0].strip(" .,;:")
        if len(name) >= 2:
            return name

    m = re.search(
        r"([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚáéíóúñÑ\.\&\s]{1,60}?"
        r"(?:S\.?\s*A\.?|S\.?\s*A\.?\s*S\.?|C[ií]a\.?|Ltda\.?|LLC|Inc\.?|Corp\.?))",
        cleaned,
    )
    if m:
        return m.group(1).strip(" .,;:")

    first = cleaned.split("\n")[0].strip()
    first = re.split(r"[.!?,;]", first)[0].strip()
    if 2 <= len(first) <= 80 and not re.search(
        r"\b(?:distribu|comercial|fabric|colaborador|emplead|personas|tenemos|contamos)\b",
        first,
        re.I,
    ):
        words = first.split()
        if 1 <= len(words) <= 8:
            return first
    return None


def _extract_activity(text: str, org_name: str | None) -> str | None:
    cleaned = (text or "").strip()
    if not cleaned:
        return None

    working = cleaned
    if org_name and org_name.lower() in working.lower():
        working = re.sub(re.escape(org_name), " ", working, flags=re.I).strip()

    m = re.search(
        r"(?:actividad principal(?: es)?|nos dedicamos a|nos dedicamos|nuestra actividad(?: es)?|"
        r"a qu[eé] nos dedicamos|giro(?: es)?|ofrecemos|principalmente)\s*[:\-]?\s*(.+)",
        working,
        re.I | re.S,
    )
    if m:
        activity = m.group(1).strip()
        activity = re.split(r"(?:\n|tenemos|contamos|somos\s+\d)", activity, maxsplit=1, flags=re.I)[0]
        activity = activity.strip(" .,;:")
        if len(activity) >= 5:
            return activity[:400]

    for part in re.split(r"[.\n;]", cleaned):
        part_n = _normalize(part)
        if any(h in part_n for h in _ACTIVITY_HINTS) and len(part.strip()) >= 8:
            candidate = part.strip()
            if org_name and candidate.lower().startswith(org_name.lower()):
                candidate = candidate[len(org_name):].strip(" ,.-:")
            candidate = re.sub(
                r",?\s*(?:tenemos|contamos con|somos)\s+\d+\s*(?:colaboradores|empleados|personas)?\.?\s*$",
                "",
                candidate,
                flags=re.I,
            ).strip(" ,.-:")
            if len(candidate) >= 5:
                return candidate[:400]

    if org_name and len(working) >= 12:
        leftover = re.sub(
            r"\b(?:tenemos|contamos con|somos)\s+\d+\s*(?:colaboradores|empleados|personas)?\b",
            "",
            working,
            flags=re.I,
        ).strip(" ,.-:")
        leftover = leftover.lstrip(", ").strip()
        if len(leftover) >= 12 and match_employee_size(leftover) is None:
            return leftover[:400]
    return None


def extract_org_profile(text: str, current: dict | None = None) -> dict[str, Any]:
    """Fusiona datos actuales con lo detectado en el texto del usuario."""
    profile: dict[str, Any] = {
        "org_name": (current or {}).get("org_name"),
        "main_activity": (current or {}).get("main_activity"),
        "employee_size": (current or {}).get("employee_size"),
    }
    raw = (text or "").strip()
    if not raw:
        return {k: v for k, v in profile.items() if v}

    size = match_employee_size(raw)
    if size:
        profile["employee_size"] = size

    name = _extract_org_name(raw)
    if name:
        profile["org_name"] = name

    activity = _extract_activity(raw, profile.get("org_name"))
    if activity:
        profile["main_activity"] = activity

    # Si solo falta un campo, aceptar el texto completo como ese valor
    gaps = missing_fields(profile)
    if len(gaps) == 1 and len(raw) >= 2:
        field = gaps[0]
        if field == "org_name":
            profile["org_name"] = raw[:120].strip()
        elif field == "main_activity" and len(raw) >= 3:
            profile["main_activity"] = raw[:400].strip()
        elif field == "employee_size":
            matched = match_employee_size(raw)
            if matched:
                profile["employee_size"] = matched

    return {k: v for k, v in profile.items() if v}


def missing_fields(profile: dict | None) -> list[str]:
    p = profile or {}
    missing: list[str] = []
    if not (p.get("org_name") or "").strip():
        missing.append("org_name")
    if not (p.get("main_activity") or "").strip():
        missing.append("main_activity")
    if not (p.get("employee_size") or "").strip():
        missing.append("employee_size")
    return missing


def open_org_prompt(org_name: str | None = None) -> str:
    known = (org_name or "").strip()
    if known:
        return (
            f"Perfecto. Ya tenemos registrada la organización «{known}».\n\n"
            "Para continuar, cuéntame en un mensaje:\n\n"
            "• Actividad principal (a qué se dedica)\n"
            "• Aproximadamente cuántos colaboradores tiene\n\n"
            "Puedes escribirlo con tus propias palabras."
        )
    return (
        "Para comenzar, cuéntame sobre tu organización:\n\n"
        "• Nombre de la empresa\n"
        "• Actividad principal (a qué se dedica)\n"
        "• Aproximadamente cuántos colaboradores tiene\n\n"
        "Puedes escribirlo con tus propias palabras."
    )


def prompt_for_missing(missing: list[str], profile: dict | None = None) -> str:
    p = profile or {}
    known_name = (p.get("org_name") or "").strip()
    missing = [m for m in (missing or []) if not (m == "org_name" and known_name)]
    if not missing or set(missing) == {"org_name", "main_activity", "employee_size"}:
        return open_org_prompt(known_name or None)

    labels = [_FIELD_LABELS[m] for m in missing if m in _FIELD_LABELS]
    if len(labels) == 1:
        field = missing[0]
        if field == "employee_size":
            prefix = f"de «{known_name}»" if known_name else ""
            return (
                f"Gracias. Para completar el perfil {prefix}, indícame aproximadamente "
                "cuántos colaboradores tiene la organización "
                "(o el rango: micro, pequeña, mediana o grande)."
            ).replace("  ", " ")
        return f"Gracias. Me falta {labels[0]}. ¿Podrías indicármelo?"

    joined = ", ".join(labels[:-1]) + f" y {labels[-1]}"
    known = []
    if p.get("org_name"):
        known.append(f"organización: {p['org_name']}")
    if p.get("main_activity"):
        known.append(f"actividad: {p['main_activity']}")
    if p.get("employee_size"):
        known.append(f"tamaño: {p['employee_size']}")
    prefix = ("Ya registré " + "; ".join(known) + ".\n\n") if known else ""
    return f"{prefix}Aún necesito {joined}. Puedes responderlo en un solo mensaje."
