import json
import re
import uuid
from xml.etree import ElementTree as ET
from xml.dom import minidom

from pathlib import Path

from app.core.config import settings
from app.services.llm_service import LLMService

PROMPTS_DIR = Path(__file__).parent.parent / "prompts"

BPMN_NS = "http://www.omg.org/spec/BPMN/20100524/MODEL"
BPMNDI_NS = "http://www.omg.org/spec/BPMN/20100524/DI"
DC_NS = "http://www.omg.org/spec/DD/20100524/DC"
DI_NS = "http://www.omg.org/spec/DD/20100524/DI"

NS_MAP = {
    "bpmn": BPMN_NS,
    "bpmndi": BPMNDI_NS,
    "dc": DC_NS,
    "di": DI_NS,
}

ELEMENT_SIZES = {
    "startEvent": (36, 36),
    "endEvent": (36, 36),
    "userTask": (120, 80),
    "serviceTask": (120, 80),
    "manualTask": (120, 80),
    "scriptTask": (120, 80),
    "subProcess": (140, 100),
    "exclusiveGateway": (50, 50),
    "parallelGateway": (50, 50),
    "inclusiveGateway": (50, 50),
}

LANE_HEIGHT = 120
HORIZONTAL_GAP = 180
START_X = 100
START_Y = 80


class BpmnGenerator:
    """Genera BPMN XML 2.0 a partir del modelo intermedio JSON."""

    def __init__(self):
        self.llm = LLMService()

    def _parse_json(self, text: str) -> dict:
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            match = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
            if match:
                return json.loads(match.group(1))
            match = re.search(r"\{[\s\S]*\}", text)
            if match:
                return json.loads(match.group(0))
            raise ValueError("No se pudo parsear la respuesta JSON del LLM")

    async def generate_from_llm(self, process_info: dict, diagram_type: str = "macro") -> dict:
        system_prompt = (PROMPTS_DIR / "system.txt").read_text(encoding="utf-8")
        bpmn_prompt = (PROMPTS_DIR / "bpmn_generation.txt").read_text(encoding="utf-8")
        user_prompt = bpmn_prompt.format(
            process_info=json.dumps(process_info, ensure_ascii=False, indent=2),
            diagram_type=diagram_type,
        )

        response = await self.llm.generate(system_prompt, user_prompt, json_mode=True, temperature=0.1)
        model = self._parse_json(response)
        if not model.get("process", {}).get("elements"):
            raise ValueError("El modelo BPMN generado por IA no contiene elementos")
        return model

    def model_to_bpmn_xml(self, model_data: dict) -> str:
        process = model_data.get("process", model_data)
        process_id = process.get("id", f"Process_{uuid.uuid4().hex[:8]}")
        process_name = process.get("name", "Proceso")

        ET.register_namespace("bpmn", BPMN_NS)
        ET.register_namespace("bpmndi", BPMNDI_NS)
        ET.register_namespace("dc", DC_NS)
        ET.register_namespace("di", DI_NS)

        root = ET.Element(f"{{{BPMN_NS}}}definitions", {
            "id": f"Definitions_{uuid.uuid4().hex[:8]}",
            "targetNamespace": "http://agente-procesos.local/bpmn",
            "exporter": "Agente de Procesos BPMN",
            "exporterVersion": "1.0",
        })

        collaboration = ET.SubElement(root, f"{{{BPMN_NS}}}collaboration", {
            "id": f"Collaboration_{uuid.uuid4().hex[:8]}",
        })

        bpmn_process = ET.SubElement(root, f"{{{BPMN_NS}}}process", {
            "id": process_id,
            "name": process_name,
            "isExecutable": "false",
        })

        pools = process.get("pools", [])
        elements = process.get("elements", [])
        flows = process.get("flows", [])

        lane_map = {}
        for pool in pools:
            participant = ET.SubElement(collaboration, f"{{{BPMN_NS}}}participant", {
                "id": pool["id"],
                "name": pool.get("name", ""),
                "processRef": process_id,
            })
            for lane in pool.get("lanes", []):
                lane_map[lane["id"]] = lane
                lane_el = ET.SubElement(bpmn_process, f"{{{BPMN_NS}}}lane", {
                    "id": lane["id"],
                    "name": lane.get("name", ""),
                })
                lane_el.set("name", lane.get("name", ""))

        element_positions = self._calculate_positions(elements, lane_map)

        for elem in elements:
            self._add_bpmn_element(bpmn_process, elem, lane_map)

        for flow in flows:
            flow_attrs = {
                "id": flow["id"],
                "sourceRef": flow["source"],
                "targetRef": flow["target"],
            }
            if flow.get("name"):
                flow_attrs["name"] = flow["name"]
            flow_el = ET.SubElement(bpmn_process, f"{{{BPMN_NS}}}sequenceFlow", flow_attrs)
            if flow.get("condition"):
                cond = ET.SubElement(flow_el, f"{{{BPMN_NS}}}conditionExpression", {
                    f"{{{BPMN_NS}}}type": "tFormalExpression",
                })
                cond.text = flow["condition"]

        self._add_diagram(root, process_id, pools, elements, flows, element_positions)

        xml_str = ET.tostring(root, encoding="unicode")
        return minidom.parseString(xml_str).toprettyxml(indent="  ")

    def model_to_bizagi_xml(self, model_data: dict) -> str:
        """Genera BPMN 2.0 XML compatible con Bizagi Modeler (importación estándar)."""
        process = model_data.get("process", model_data)
        process_id = process.get("id", f"Process_{uuid.uuid4().hex[:8]}")
        process_name = process.get("name", "Proceso")

        ET.register_namespace("bpmn", BPMN_NS)
        ET.register_namespace("bpmndi", BPMNDI_NS)
        ET.register_namespace("dc", DC_NS)
        ET.register_namespace("di", DI_NS)
        ET.register_namespace("xsi", "http://www.w3.org/2001/XMLSchema-instance")

        root = ET.Element(f"{{{BPMN_NS}}}definitions", {
            "id": f"Definitions_{uuid.uuid4().hex[:8]}",
            "targetNamespace": "http://www.bizagi.com/bpmn20",
            "exporter": "Bizagi Modeler",
            "exporterVersion": "3.9.0",
        })

        collaboration = ET.SubElement(root, f"{{{BPMN_NS}}}collaboration", {
            "id": f"Collaboration_{uuid.uuid4().hex[:8]}",
        })

        bpmn_process = ET.SubElement(root, f"{{{BPMN_NS}}}process", {
            "id": process_id,
            "name": process_name,
            "isExecutable": "false",
        })

        pools = process.get("pools", [])
        elements = process.get("elements", [])
        flows = process.get("flows", [])

        lane_map = {}
        for pool in pools:
            ET.SubElement(collaboration, f"{{{BPMN_NS}}}participant", {
                "id": pool["id"],
                "name": pool.get("name", ""),
                "processRef": process_id,
            })
            for lane in pool.get("lanes", []):
                lane_map[lane["id"]] = lane
                ET.SubElement(bpmn_process, f"{{{BPMN_NS}}}lane", {
                    "id": lane["id"],
                    "name": lane.get("name", ""),
                })

        element_positions = self._calculate_positions(elements, lane_map)

        for elem in elements:
            self._add_bpmn_element(bpmn_process, elem, lane_map)

        for flow in flows:
            flow_attrs = {
                "id": flow["id"],
                "sourceRef": flow["source"],
                "targetRef": flow["target"],
            }
            if flow.get("name"):
                flow_attrs["name"] = flow["name"]
            flow_el = ET.SubElement(bpmn_process, f"{{{BPMN_NS}}}sequenceFlow", flow_attrs)
            if flow.get("condition"):
                cond = ET.SubElement(flow_el, f"{{{BPMN_NS}}}conditionExpression", {
                    f"{{{BPMN_NS}}}type": "tFormalExpression",
                })
                cond.text = flow["condition"]

        self._add_diagram(root, process_id, pools, elements, flows, element_positions)

        xml_str = ET.tostring(root, encoding="unicode")
        pretty = minidom.parseString(xml_str).toprettyxml(indent="  ")
        if not pretty.startswith("<?xml"):
            pretty = '<?xml version="1.0" encoding="UTF-8"?>\n' + pretty
        return pretty

    def _add_bpmn_element(self, parent, elem: dict, lane_map: dict):
        elem_type = elem["type"]
        tag_map = {
            "startEvent": "startEvent",
            "endEvent": "endEvent",
            "intermediateEvent": "intermediateCatchEvent",
            "userTask": "userTask",
            "serviceTask": "serviceTask",
            "manualTask": "manualTask",
            "scriptTask": "scriptTask",
            "subProcess": "subProcess",
            "exclusiveGateway": "exclusiveGateway",
            "parallelGateway": "parallelGateway",
            "inclusiveGateway": "inclusiveGateway",
        }
        tag = tag_map.get(elem_type, "task")
        attrs = {"id": elem["id"]}
        if elem.get("name"):
            attrs["name"] = elem["name"]

        el = ET.SubElement(parent, f"{{{BPMN_NS}}}{tag}", attrs)

        lane_id = elem.get("lane")
        if lane_id and lane_id in lane_map:
            for lane_el in parent.findall(f"{{{BPMN_NS}}}lane"):
                if lane_el.get("id") == lane_id:
                    ref = ET.SubElement(lane_el, f"{{{BPMN_NS}}}flowNodeRef")
                    ref.text = elem["id"]

    def _calculate_positions(self, elements: list, lane_map: dict) -> dict:
        positions = {}
        lane_elements: dict[str, list] = {}
        for elem in elements:
            lane_id = elem.get("lane", "default")
            lane_elements.setdefault(lane_id, []).append(elem)

        lane_ids = list(lane_map.keys()) if lane_map else ["default"]
        for lane_idx, lane_id in enumerate(lane_ids):
            lane_y = START_Y + lane_idx * LANE_HEIGHT
            for elem_idx, elem in enumerate(lane_elements.get(lane_id, [])):
                x = START_X + elem_idx * HORIZONTAL_GAP
                w, h = ELEMENT_SIZES.get(elem["type"], (100, 80))
                positions[elem["id"]] = {"x": x, "y": lane_y, "width": w, "height": h}
        return positions

    def _add_diagram(self, root, process_id, pools, elements, flows, positions):
        diagram = ET.SubElement(root, f"{{{BPMNDI_NS}}}BPMNDiagram", {
            "id": f"BPMNDiagram_{process_id}",
        })
        plane = ET.SubElement(diagram, f"{{{BPMNDI_NS}}}BPMNPlane", {
            "id": f"BPMNPlane_{process_id}",
            "bpmnElement": process_id,
        })

        for pool in pools:
            pool_lanes = pool.get("lanes", [])
            pool_height = max(len(pool_lanes), 1) * LANE_HEIGHT
            shape = ET.SubElement(plane, f"{{{BPMNDI_NS}}}BPMNShape", {
                "id": f"{pool['id']}_di",
                "bpmnElement": pool["id"],
                "isHorizontal": "true",
            })
            bounds = ET.SubElement(shape, f"{{{DC_NS}}}Bounds", {
                "x": "50", "y": "50",
                "width": str(len(elements) * HORIZONTAL_GAP + 200),
                "height": str(pool_height + 40),
            })

            for lane_idx, lane in enumerate(pool_lanes):
                lane_shape = ET.SubElement(plane, f"{{{BPMNDI_NS}}}BPMNShape", {
                    "id": f"{lane['id']}_di",
                    "bpmnElement": lane["id"],
                    "isHorizontal": "true",
                })
                ET.SubElement(lane_shape, f"{{{DC_NS}}}Bounds", {
                    "x": "80",
                    "y": str(50 + lane_idx * LANE_HEIGHT),
                    "width": str(len(elements) * HORIZONTAL_GAP + 150),
                    "height": str(LANE_HEIGHT),
                })

        for elem in elements:
            pos = positions.get(elem["id"], {"x": 100, "y": 100, "width": 100, "height": 80})
            shape = ET.SubElement(plane, f"{{{BPMNDI_NS}}}BPMNShape", {
                "id": f"{elem['id']}_di",
                "bpmnElement": elem["id"],
            })
            ET.SubElement(shape, f"{{{DC_NS}}}Bounds", {
                "x": str(pos["x"]),
                "y": str(pos["y"]),
                "width": str(pos["width"]),
                "height": str(pos["height"]),
            })

        for flow in flows:
            edge = ET.SubElement(plane, f"{{{BPMNDI_NS}}}BPMNEdge", {
                "id": f"{flow['id']}_di",
                "bpmnElement": flow["id"],
            })
            src_pos = positions.get(flow["source"], {"x": 100, "y": 100, "width": 100, "height": 80})
            tgt_pos = positions.get(flow["target"], {"x": 300, "y": 100, "width": 100, "height": 80})
            ET.SubElement(edge, f"{{{DI_NS}}}waypoint", {
                "x": str(src_pos["x"] + src_pos["width"]),
                "y": str(src_pos["y"] + src_pos["height"] // 2),
            })
            ET.SubElement(edge, f"{{{DI_NS}}}waypoint", {
                "x": str(tgt_pos["x"]),
                "y": str(tgt_pos["y"] + tgt_pos["height"] // 2),
            })

    def validate_model(self, model_data: dict) -> list[str]:
        process = model_data.get("process", model_data)
        elements = process.get("elements", [])
        flows = process.get("flows", [])
        errors = []

        element_ids = {e["id"] for e in elements}
        start_events = [e for e in elements if e["type"] == "startEvent"]
        end_events = [e for e in elements if e["type"] == "endEvent"]

        if len(start_events) != 1:
            errors.append(f"Debe haber exactamente 1 startEvent, encontrados: {len(start_events)}")
        if len(end_events) < 1:
            errors.append("Debe haber al menos 1 endEvent")

        connected = set()
        for flow in flows:
            connected.add(flow["source"])
            connected.add(flow["target"])
            if flow["source"] not in element_ids:
                errors.append(f"Flow source '{flow['source']}' no existe")
            if flow["target"] not in element_ids:
                errors.append(f"Flow target '{flow['target']}' no existe")

        for elem in elements:
            if elem["type"] not in ("startEvent",) and elem["id"] not in connected:
                errors.append(f"Elemento '{elem['id']}' ({elem.get('name', '')}) no está conectado")

        return errors
