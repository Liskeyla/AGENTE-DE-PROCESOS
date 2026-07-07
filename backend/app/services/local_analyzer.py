"""Análisis local de procesos sin depender de API de IA."""

import json
import re
from typing import Optional


class LocalAnalyzer:
    """Extracción heurística de información de procesos desde texto."""

    @staticmethod
    def extract_from_text(
        text: str,
        filename: str = "",
        source_type: str = "other",
        area: Optional[str] = None,
    ) -> dict:
        if not text or not text.strip():
            return LocalAnalyzer._empty_extraction(filename, 0.0)

        is_interview = source_type == "interview" or bool(
            re.search(r"entrevista|transcripci[oó]n|interview", filename, re.I)
        )

        activities = []
        seen = set()

        patterns = [
            r"^[\d]+[\.\)]\s+(.+)$",
            r"^[-•*]\s+(.+)$",
            r"^(?:Paso|Actividad|Proceso|Fase)\s*\d*[:\.]?\s*(.+)$",
        ]
        if is_interview:
            patterns.extend([
                r"^(?:Entrevistado|Entrevistador|Speaker|Participante)[:\s]+(.+)$",
                r"^(?:P|R|Q|A)[:\.\)]\s+(.+)$",
                r"^([A-ZÁÉÍÓÚ][^:]{2,30}):\s+(.+)$",
            ])

        for line in text.split("\n"):
            line = line.strip()
            if len(line) < 8:
                continue
            for pattern in patterns:
                match = re.match(pattern, line, re.IGNORECASE)
                if match:
                    name = (match.group(2) if match.lastindex and match.lastindex >= 2 else match.group(1)).strip()[:300]
                    is_numbered = bool(re.match(r"^[\d]+[\.\)]", line))
                    is_process_line = bool(re.search(
                        r"\b(primero|luego|después|despues|entonces|finalmente|cuando|proceso|solicitud|aprob|valid|registr|revis|entreg|dispens)\b",
                        name, re.I,
                    ))
                    accept = (not is_interview) or is_numbered or is_process_line or len(name) > 15
                    if accept:
                        key = name.lower()[:50]
                        if key not in seen and len(name) > 5:
                            seen.add(key)
                            activities.append({
                                "name": name,
                                "description": name,
                                "responsible": area or "No identificado",
                                "is_manual": True,
                                "is_automated": bool(re.search(r"automati|sistema|SAP|ERP", name, re.I)),
                                "systems": [],
                                "estimated_time_min": 0,
                                "inputs": [],
                                "outputs": [],
                            })
                    break

        if is_interview and len(activities) < 8:
            activities.extend(LocalAnalyzer._extract_interview_narrative(text, area, seen))

        if not activities:
            sentences = re.split(r"[.;\n]", text)
            limit = 25 if is_interview else 15
            for s in sentences[:limit]:
                s = s.strip()
                if 20 < len(s) < 200 and re.search(
                    r"(proceso|aprob|revis|valid|registr|enví|solicit|verific|control)",
                    s, re.I
                ):
                    activities.append({
                        "name": s[:150],
                        "description": s,
                        "responsible": area or "No identificado",
                        "is_manual": True,
                        "systems": [],
                    })

        areas = list(set(re.findall(
            r"(?:área|departamento|equipo|responsable)[:\s]+([A-Za-zÁÉÍÓÚáéíóúñÑ\s]{3,30})",
            text, re.I
        )))
        if area and area not in areas:
            areas.append(area)

        systems = list(set(re.findall(
            r"\b(SAP|ERP|Excel|Word|SharePoint|CRM|Oracle|Salesforce|Sistema\s+\w+)\b",
            text, re.I
        )))

        participants = []
        for match in re.finditer(
            r"([A-ZÁÉÍÓÚ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚ][a-záéíóúñ]+)*)\s*[-–]\s*(\w+)",
            text
        ):
            participants.append({
                "name": match.group(1),
                "role": match.group(2),
                "area": area or "",
            })

        problems = [
            m.group(0)[:200]
            for m in re.finditer(
                r"(?:problema|retraso|cuello de botella|demora|manual|lento|error)[^.]{5,80}",
                text, re.I
            )
        ][:5]

        decisions = []
        for match in re.finditer(
            r"(?:si|cuando|en caso de)\s+(.{10,80})(?:,|\.|entonces)\s*(.{10,80})",
            text, re.I
        ):
            decisions.append({
                "description": match.group(0)[:150],
                "condition": match.group(1).strip(),
                "true_path": match.group(2).strip(),
                "false_path": "Flujo alternativo",
            })

        sequence = []
        for i in range(len(activities) - 1):
            sequence.append({
                "from": activities[i]["name"],
                "to": activities[i + 1]["name"],
            })

        score = min(0.75, 0.2 + len(activities) * 0.05 + len(areas) * 0.05)

        return {
            "activities": activities[:40],
            "participants": participants[:10],
            "areas": areas[:10],
            "systems": systems[:10],
            "decisions": decisions[:10],
            "inputs": LocalAnalyzer._find_keywords(text, r"(?:entrada|input|recibe|llega)[:\s]+(.+)"),
            "outputs": LocalAnalyzer._find_keywords(text, r"(?:salida|output|entrega|genera)[:\s]+(.+)"),
            "business_rules": [],
            "problems": problems,
            "opportunities": LocalAnalyzer._find_keywords(
                text, r"(?:automatiz|mejorar|optimiz|digitaliz)[^.]{5,60}"
            ),
            "exceptions": [],
            "documents": [filename] if filename else [],
            "sequence": sequence,
            "confidence_score": round(score, 2),
            "source_document": filename,
            "extraction_mode": "local",
        }

    @staticmethod
    def _extract_interview_narrative(text: str, area: Optional[str], seen: set) -> list[dict]:
        """Extrae pasos adicionales de narrativa en transcripciones de entrevista."""
        extra = []
        verb_pattern = re.compile(
            r"(?:se\s+)?(?:realiza|hace|valida|verifica|registra|aprueba|revisa|entrega|dispensa|solicita|recibe|confirma|notifica|archiva|digitaliza|imprime|firma|escanea)[^.]{5,120}",
            re.I,
        )
        for match in verb_pattern.finditer(text):
            phrase = match.group(0).strip()
            key = phrase.lower()[:50]
            if key not in seen and len(phrase) > 12:
                seen.add(key)
                extra.append({
                    "name": phrase[:150],
                    "description": phrase,
                    "responsible": area or "No identificado",
                    "is_manual": True,
                    "is_automated": bool(re.search(r"automati|sistema|SAP|ERP", phrase, re.I)),
                    "systems": [],
                })

        for segment in re.split(
            r"\b(?:primero|luego|después|despues|entonces|finalmente|posteriormente|a continuación)\b",
            text, flags=re.I,
        ):
            segment = segment.strip()
            if 15 < len(segment) < 250:
                key = segment.lower()[:50]
                if key not in seen:
                    seen.add(key)
                    extra.append({
                        "name": segment[:150],
                        "description": segment,
                        "responsible": area or "No identificado",
                        "is_manual": True,
                        "systems": [],
                    })
        return extra[:25]

    @staticmethod
    def consolidate(extractions: list) -> dict:
        if not extractions:
            return {
                "process_name": "Proceso sin documentar",
                "macro_flow": {},
                "consolidated_activities": [],
                "completeness_score": 0.0,
                "contradictions": [],
            }

        all_activities = []
        all_areas: set[str] = set()
        all_systems: set[str] = set()
        all_problems: list[str] = []
        all_participants: list[dict] = []
        all_decisions: list[dict] = []
        all_sequence: list[dict] = []
        seen_participants: set[str] = set()

        for ext in extractions:
            all_activities.extend(ext.get("activities", []))
            all_areas.update(ext.get("areas", []))
            all_systems.update(ext.get("systems", []))
            all_problems.extend(ext.get("problems", []))
            all_decisions.extend(ext.get("decisions", []))
            all_sequence.extend(ext.get("sequence", []))
            for p in ext.get("participants", []):
                key = f"{p.get('name','')}:{p.get('role','')}".lower()
                if key not in seen_participants:
                    seen_participants.add(key)
                    all_participants.append(p)
            for act in ext.get("activities", []):
                resp = (act.get("responsible") or "").strip()
                if resp and resp not in ("No identificado", "General"):
                    all_areas.add(resp)

        process_name = "Proceso Consolidado"
        source_filename = ""
        for ext in extractions:
            fn = ext.get("source_document", "")
            if fn and not source_filename:
                source_filename = fn
                base = re.sub(r"[_\-]+", " ", fn.rsplit(".", 1)[0]).strip()
                if base:
                    process_name = f"Proceso: {base}"
        for ext in extractions:
            for act in ext.get("activities", [])[:1]:
                if process_name == "Proceso Consolidado":
                    words = act.get("name", "").split()[:4]
                    if words:
                        process_name = f"Proceso: {' '.join(words)}"
                break

        main_steps = [a.get("name", "") for a in all_activities[:12] if a.get("name")]
        if not main_steps:
            for item in all_sequence[:12]:
                step = item.get("from") or item.get("to")
                if step and step not in main_steps:
                    main_steps.append(step)

        ordered_activities = LocalAnalyzer._order_activities(all_activities, all_sequence)

        completeness = min(0.85, 0.3 + len(all_activities) * 0.04 + len(all_areas) * 0.05)

        return {
            "process_name": process_name,
            "source_filename": source_filename,
            "macro_flow": {
                "description": f"Proceso con {len(all_activities)} actividades identificadas",
                "main_steps": main_steps or [f"Analizar documento: {source_filename}" if source_filename else "Documentar el proceso"],
                "areas_involved": list(all_areas),
                "systems_involved": list(all_systems),
                "critical_points": all_problems[:3],
                "main_inputs": [],
                "main_outputs": [],
            },
            "subprocesses": [
                {
                    "name": area or "General",
                    "area": area or "General",
                    "activities": LocalAnalyzer._activities_for_area(area, ordered_activities)[:15],
                }
                for area in (list(all_areas) or ["General"])
            ],
            "consolidated_activities": ordered_activities,
            "consolidated_participants": all_participants,
            "consolidated_decisions": all_decisions[:15],
            "consolidated_sequence": all_sequence,
            "consolidated_rules": [],
            "contradictions": [],
            "completeness_score": round(completeness, 2),
            "missing_areas": [],
            "extraction_mode": "local",
        }

    @staticmethod
    def generate_questions(consolidated: dict) -> list[dict]:
        questions = []
        activities = consolidated.get("consolidated_activities", [])

        if not activities:
            questions.append({
                "category": "missing_info",
                "priority": "critical",
                "question": "No se identificaron actividades claras. ¿Cuáles son los pasos principales del proceso?",
                "context": "El documento no contiene una secuencia estructurada de actividades.",
                "suggested_answers": [],
            })
        else:
            questions.append({
                "category": "responsibility",
                "priority": "high",
                "question": f"Se identificaron {len(activities)} actividades. ¿Quién es el responsable principal de cada una?",
                "context": "Falta claridad en roles y responsables por actividad.",
                "suggested_answers": [],
            })

        if not consolidated.get("macro_flow", {}).get("systems_involved"):
            questions.append({
                "category": "system",
                "priority": "medium",
                "question": "¿Qué sistemas o herramientas se utilizan en este proceso?",
                "context": "No se detectaron sistemas en los documentos.",
                "suggested_answers": ["SAP", "Excel", "Manual / Sin sistema"],
            })

        questions.append({
            "category": "exception",
            "priority": "medium",
            "question": "¿Qué ocurre cuando una solicitud es rechazada o no cumple los requisitos?",
            "context": "No se identificó un flujo de excepción en los documentos.",
            "suggested_answers": [],
        })

        return questions[:5]

    @staticmethod
    def merge_answer_to_consolidated(consolidated: dict, answer: str) -> dict:
        """Incorpora una respuesta del usuario al modelo consolidado."""
        merged = json.loads(json.dumps(consolidated))
        activities = merged.setdefault("consolidated_activities", [])
        answer_lower = answer.lower()

        if re.search(r"\b(sap|excel|sistema|herramienta)\b", answer_lower):
            systems = merged.setdefault("macro_flow", {}).setdefault("systems_involved", [])
            for token in re.findall(r"\b[A-Z][A-Za-z0-9]+\b", answer):
                if token not in systems and len(token) > 2:
                    systems.append(token)

        if re.search(r"\b(responsable|encargado|área|departamento)\b", answer_lower) and activities:
            area_match = re.search(r"(?:área|departamento|responsable)[:\s]+([^\n,.]+)", answer, re.I)
            if area_match:
                area = area_match.group(1).strip()[:60]
                areas = merged.setdefault("macro_flow", {}).setdefault("areas_involved", [])
                if area not in areas:
                    areas.append(area)
                if activities:
                    activities[0]["responsible"] = area

        if re.search(r"\b(paso|actividad|proceso)\b", answer_lower):
            steps = re.split(r"[,;\n]|(?:\d+[\.\)])", answer)
            for step in steps:
                step = step.strip()
                if len(step) > 5 and not re.match(r"^(sí|no|el|la|los|las)\b", step, re.I):
                    if not any(step.lower() in a.get("name", "").lower() for a in activities):
                        activities.append({
                            "name": step[:100],
                            "responsible": merged.get("macro_flow", {}).get("areas_involved", ["General"])[0],
                            "is_automated": "autom" in step.lower() or "sistema" in step.lower(),
                        })

        return merged

    @staticmethod
    def _activities_for_area(area: str, activities: list[dict]) -> list[dict]:
        area_lower = area.lower()
        return [
            a for a in activities
            if area_lower in (a.get("responsible") or "").lower()
            or area_lower in (a.get("name") or "").lower()
            or (a.get("responsible") or "").lower() == area_lower
        ]

    @staticmethod
    def _order_activities(activities: list[dict], sequence: list[dict]) -> list[dict]:
        if not activities:
            return []
        if not sequence:
            return activities

        name_to_act = {}
        for act in activities:
            name = act.get("name", "")
            if name:
                name_to_act[name.lower()] = act

        ordered: list[dict] = []
        seen: set[str] = set()

        for link in sequence:
            for key in ("from", "to"):
                step_name = link.get(key, "")
                if not step_name:
                    continue
                act = name_to_act.get(step_name.lower())
                if act:
                    act_key = act.get("name", "").lower()
                    if act_key not in seen:
                        seen.add(act_key)
                        ordered.append(act)

        for act in activities:
            act_key = act.get("name", "").lower()
            if act_key not in seen:
                ordered.append(act)

        return ordered

    @staticmethod
    def _resolve_activities(consolidated: dict) -> list[dict]:
        """Obtiene actividades del modelo consolidado o genera pasos mínimos desde el documento."""
        activities = list(consolidated.get("consolidated_activities", []))
        sequence = consolidated.get("consolidated_sequence", [])
        if sequence:
            activities = LocalAnalyzer._order_activities(activities, sequence)
        macro = consolidated.get("macro_flow", {})
        areas = macro.get("areas_involved", []) or ["General"]
        default_area = areas[0]

        if not activities:
            for step in macro.get("main_steps", []):
                if step and isinstance(step, str):
                    activities.append({
                        "name": step[:150],
                        "responsible": default_area,
                        "is_manual": True,
                        "is_automated": False,
                    })

        if not activities:
            for decision in consolidated.get("consolidated_decisions", [])[:3]:
                desc = decision.get("description") or decision.get("condition")
                if desc:
                    activities.append({
                        "name": desc[:150],
                        "responsible": default_area,
                        "is_manual": True,
                    })

        if not activities:
            source = consolidated.get("source_filename", "")
            name = f"Procesar documento: {source}" if source else "Documentar y validar el proceso"
            activities.append({
                "name": name[:150],
                "responsible": default_area,
                "is_manual": True,
                "is_automated": False,
            })

        return activities

    @staticmethod
    def build_bpmn_model(consolidated: dict, diagram_type: str = "detailed") -> dict:
        if diagram_type == "macro":
            return LocalAnalyzer._build_macro_model(consolidated)
        return LocalAnalyzer._build_detailed_model(consolidated)

    @staticmethod
    def _lane_setup(consolidated: dict, activities: list[dict]):
        participants = consolidated.get("consolidated_participants", [])
        areas = list(consolidated.get("macro_flow", {}).get("areas_involved", []) or [])
        for p in participants:
            a = (p.get("area") or "").strip()
            if a and a not in areas:
                areas.append(a)
        for act in activities:
            resp = (act.get("responsible") or "").strip()
            if resp and resp not in areas and resp != "No identificado":
                areas.append(resp)
        if not areas:
            areas = ["General"]
        max_lanes = 10
        lanes = [{"id": f"lane_{i}", "name": area, "type": "area"} for i, area in enumerate(areas[:max_lanes])]
        lane_map = {lane["name"]: lane["id"] for lane in lanes}
        default_lane = lanes[0]["id"]

        def lane_for(act: dict) -> str:
            resp = (act.get("responsible") or "").strip()
            if resp in lane_map:
                return lane_map[resp]
            resp_lower = resp.lower()
            for name, lid in lane_map.items():
                if resp_lower and (resp_lower in name.lower() or name.lower() in resp_lower):
                    return lid
            return default_lane

        return lanes, lane_map, default_lane, lane_for

    @staticmethod
    def _build_detailed_model(consolidated: dict) -> dict:
        """Diagrama detallado: todas las actividades paso a paso con carriles y decisiones."""
        activities = LocalAnalyzer._resolve_activities(consolidated)
        decisions = consolidated.get("consolidated_decisions", [])
        lanes, lane_map, default_lane, lane_for = LocalAnalyzer._lane_setup(consolidated, activities)

        elements = [{"id": "start_1", "type": "startEvent", "name": "Inicio del proceso", "lane": default_lane}]
        flows = []
        prev_id = "start_1"
        flow_idx = 0
        max_tasks = 40

        for i, act in enumerate(activities[:max_tasks]):
            task_id = f"task_{i}"
            task_name = act.get("name", f"Actividad {i+1}")[:100]
            desc = act.get("description", "")
            if desc and desc != task_name and len(desc) < 80:
                task_name = f"{task_name[:60]}"

            elements.append({
                "id": task_id,
                "type": "serviceTask" if act.get("is_automated") else "userTask",
                "name": task_name,
                "lane": lane_for(act),
                "is_manual": not act.get("is_automated", False),
                "is_automated": act.get("is_automated", False),
                "systems": act.get("systems", []),
            })
            flows.append({"id": f"flow_{flow_idx}", "source": prev_id, "target": task_id})
            flow_idx += 1
            prev_id = task_id

            if decisions and (i + 1) % 4 == 0 and i < len(activities) - 1:
                dec_idx = min(len(decisions) - 1, (i + 1) // 4 - 1)
                dec = decisions[dec_idx]
                gw_id = f"gw_{i}"
                elements.append({
                    "id": gw_id,
                    "type": "exclusiveGateway",
                    "name": (dec.get("condition") or dec.get("description") or "¿Cumple condición?")[:50],
                    "lane": lane_for(act),
                })
                flows.append({"id": f"flow_{flow_idx}", "source": prev_id, "target": gw_id})
                flow_idx += 1

                alt_id = f"task_exc_{i}"
                elements.append({
                    "id": alt_id,
                    "type": "userTask",
                    "name": (dec.get("false_path") or "Gestionar excepción")[:70],
                    "lane": lane_for(act),
                    "is_manual": True,
                })
                flows.append({"id": f"flow_{flow_idx}", "source": gw_id, "target": alt_id, "condition": "No"})
                flow_idx += 1

                join_id = f"join_{i}"
                elements.append({
                    "id": join_id,
                    "type": "exclusiveGateway",
                    "name": "Continuar",
                    "lane": lane_for(act),
                })
                flows.append({"id": f"flow_{flow_idx}", "source": alt_id, "target": join_id})
                flow_idx += 1
                flows.append({
                    "id": f"flow_{flow_idx}",
                    "source": gw_id,
                    "target": join_id,
                    "condition": "Sí",
                    "is_default": True,
                })
                flow_idx += 1
                prev_id = join_id

        elements.append({"id": "end_1", "type": "endEvent", "name": "Fin del proceso", "lane": default_lane})
        flows.append({"id": f"flow_{flow_idx}", "source": prev_id, "target": "end_1"})

        return {
            "process": {
                "id": "proc_detailed",
                "name": consolidated.get("process_name", "Proceso"),
                "type": "detailed",
                "pools": [{"id": "pool_1", "name": consolidated.get("process_name", "Proceso"), "lanes": lanes}],
                "elements": elements,
                "flows": flows,
                "inputs": consolidated.get("macro_flow", {}).get("main_inputs", []),
                "outputs": consolidated.get("macro_flow", {}).get("main_outputs", []),
                "critical_points": consolidated.get("macro_flow", {}).get("critical_points", []),
                "systems": consolidated.get("macro_flow", {}).get("systems_involved", []),
            }
        }

    @staticmethod
    def _build_macro_model(consolidated: dict) -> dict:
        """Diagrama macro: subprocesos por área con pasos principales."""
        activities = LocalAnalyzer._resolve_activities(consolidated)
        main_steps = consolidated.get("macro_flow", {}).get("main_steps", [])
        areas = list(consolidated.get("macro_flow", {}).get("areas_involved", []) or ["General"])
        lanes, _, default_lane, lane_for = LocalAnalyzer._lane_setup(consolidated, activities)

        elements = [{"id": "start_1", "type": "startEvent", "name": "Inicio", "lane": default_lane}]
        flows = []
        prev_id = "start_1"
        flow_idx = 0

        subprocesses = consolidated.get("subprocesses", [])
        if subprocesses and len(subprocesses) > 1:
            for i, sp in enumerate(subprocesses[:8]):
                sp_id = f"sub_{i}"
                sp_name = sp.get("name") or sp.get("area") or f"Área {i+1}"
                act_count = len(sp.get("activities", []))
                elements.append({
                    "id": sp_id,
                    "type": "subProcess",
                    "name": f"{sp_name} ({act_count} actividades)",
                    "lane": lane_for({"responsible": sp.get("area", areas[0])}),
                })
                flows.append({"id": f"flow_{flow_idx}", "source": prev_id, "target": sp_id})
                flow_idx += 1
                prev_id = sp_id
        else:
            steps = main_steps or [a.get("name", "") for a in activities[:8]]
            for i, step in enumerate(steps[:8]):
                if not step:
                    continue
                task_id = f"task_{i}"
                elements.append({
                    "id": task_id,
                    "type": "userTask",
                    "name": str(step)[:80],
                    "lane": default_lane,
                    "is_manual": True,
                })
                flows.append({"id": f"flow_{flow_idx}", "source": prev_id, "target": task_id})
                flow_idx += 1
                prev_id = task_id

        elements.append({"id": "end_1", "type": "endEvent", "name": "Fin", "lane": default_lane})
        flows.append({"id": f"flow_{flow_idx}", "source": prev_id, "target": "end_1"})

        return {
            "process": {
                "id": "proc_macro",
                "name": consolidated.get("process_name", "Proceso"),
                "type": "macro",
                "pools": [{"id": "pool_1", "name": consolidated.get("process_name", "Proceso"), "lanes": lanes}],
                "elements": elements,
                "flows": flows,
                "systems": consolidated.get("macro_flow", {}).get("systems_involved", []),
            }
        }

    @staticmethod
    def _find_keywords(text: str, pattern: str) -> list[str]:
        return [m.group(1 if m.lastindex else 0).strip()[:100] for m in re.finditer(pattern, text, re.I)][:5]

    @staticmethod
    def _empty_extraction(filename: str, score: float) -> dict:
        return {
            "activities": [], "participants": [], "areas": [], "systems": [],
            "decisions": [], "inputs": [], "outputs": [], "business_rules": [],
            "problems": [], "opportunities": [], "exceptions": [],
            "documents": [filename] if filename else [], "sequence": [],
            "confidence_score": score, "source_document": filename,
            "extraction_mode": "local",
        }
