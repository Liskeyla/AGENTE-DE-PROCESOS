"""Genera organigrama y flujos detallados por área desde el análisis de entrevistas."""

from typing import Optional


class OrgChartService:
    @staticmethod
    def build_from_consolidated(
        consolidated: dict,
        organization_name: str = "Empresa",
        extractions: Optional[list] = None,
    ) -> dict:
        extractions = extractions or []
        process_name = consolidated.get("process_name", "Proceso")
        source = consolidated.get("source_filename", "")

        participants = list(consolidated.get("consolidated_participants", []))
        if not participants:
            for ext in extractions:
                participants.extend(ext.get("participants", []))

        areas = list(consolidated.get("macro_flow", {}).get("areas_involved", []))
        for p in participants:
            area = (p.get("area") or "").strip()
            if area and area not in areas:
                areas.append(area)
        for ext in extractions:
            for area in ext.get("areas", []):
                if area and area not in areas:
                    areas.append(area)
        if not areas:
            areas = ["General"]

        nodes = [{
            "id": "org_root",
            "name": organization_name,
            "type": "organization",
            "parent_id": None,
        }]

        area_ids: dict[str, str] = {}
        for i, area in enumerate(areas[:12]):
            area_id = f"area_{i}"
            area_ids[area] = area_id
            nodes.append({
                "id": area_id,
                "name": area,
                "type": "area",
                "parent_id": "org_root",
            })

        role_seen: set[str] = set()
        for p in participants[:30]:
            area_name = (p.get("area") or "").strip() or areas[0]
            role = (p.get("role") or "Colaborador").strip()
            name = (p.get("name") or "").strip()
            parent_id = area_ids.get(area_name, area_ids.get(areas[0], "area_0"))
            role_key = f"{parent_id}:{role.lower()}"
            if role_key not in role_seen:
                role_seen.add(role_key)
                role_id = f"role_{len(role_seen)}"
                nodes.append({
                    "id": role_id,
                    "name": role,
                    "type": "role",
                    "parent_id": parent_id,
                })
            else:
                role_id = next(
                    n["id"] for n in nodes
                    if n["type"] == "role" and n["parent_id"] == parent_id and n["name"] == role
                )
            if name:
                nodes.append({
                    "id": f"person_{len(nodes)}",
                    "name": name,
                    "type": "person",
                    "parent_id": role_id,
                })

        area_flows = OrgChartService._build_area_flows(consolidated, areas)

        return {
            "organization_name": organization_name,
            "process_name": process_name,
            "source_document": source,
            "nodes": nodes,
            "area_flows": area_flows,
        }

    @staticmethod
    def _build_area_flows(consolidated: dict, areas: list[str]) -> list[dict]:
        activities = consolidated.get("consolidated_activities", [])
        subprocesses = consolidated.get("subprocesses", [])
        flows: list[dict] = []

        for area in areas:
            area_acts = OrgChartService._activities_for_area(area, activities, subprocesses)
            if not area_acts:
                continue
            steps = []
            for i, act in enumerate(area_acts[:20]):
                step_id = f"{area}_{i}"
                next_id = f"{area}_{i + 1}" if i < len(area_acts) - 1 else None
                steps.append({
                    "id": step_id,
                    "name": act.get("name", f"Paso {i + 1}")[:120],
                    "responsible": act.get("responsible") or area,
                    "area": area,
                    "is_automated": bool(act.get("is_automated")),
                    "next": next_id,
                })
            flows.append({"area": area, "steps": steps})

        if not flows and activities:
            steps = []
            for i, act in enumerate(activities[:20]):
                step_id = f"general_{i}"
                steps.append({
                    "id": step_id,
                    "name": act.get("name", f"Paso {i + 1}")[:120],
                    "responsible": act.get("responsible", "General"),
                    "area": act.get("responsible", "General"),
                    "is_automated": bool(act.get("is_automated")),
                    "next": f"general_{i + 1}" if i < min(len(activities), 20) - 1 else None,
                })
            flows.append({"area": "Proceso completo", "steps": steps})

        return flows

    @staticmethod
    def _activities_for_area(area: str, activities: list, subprocesses: list) -> list[dict]:
        area_lower = area.lower()
        matched = [
            a for a in activities
            if area_lower in (a.get("responsible") or "").lower()
            or area_lower in (a.get("name") or "").lower()
        ]
        if matched:
            return matched

        for sp in subprocesses:
            if (sp.get("area") or sp.get("name") or "").lower() == area_lower:
                return sp.get("activities", [])

        return []
