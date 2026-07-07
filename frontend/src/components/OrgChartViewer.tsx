"use client";

import { OrgChart } from "@/lib/api";

interface Props {
  chart: OrgChart;
}

function NodeBox({ node, children }: { node: { name: string; type: string }; children?: React.ReactNode }) {
  const styles: Record<string, string> = {
    organization: "bg-primary text-white border-primary",
    area: "bg-blue-100 text-blue-900 border-blue-300",
    role: "bg-amber-50 text-amber-900 border-amber-300",
    person: "bg-white text-slate-700 border-slate-300",
  };
  return (
    <div className="flex flex-col items-center">
      <div className={`px-4 py-2 rounded-lg border-2 text-sm font-medium text-center min-w-[140px] ${styles[node.type] || styles.person}`}>
        {node.type === "person" && <span className="text-xs block opacity-70">Persona</span>}
        {node.type === "role" && <span className="text-xs block opacity-70">Rol</span>}
        {node.type === "area" && <span className="text-xs block opacity-70">Área</span>}
        {node.name}
      </div>
      {children && (
        <div className="flex flex-col items-center mt-2">
          <div className="w-px h-4 bg-slate-300" />
          {children}
        </div>
      )}
    </div>
  );
}

function buildTree(nodes: OrgChart["nodes"], parentId: string | null): React.ReactNode {
  const children = nodes.filter((n) => n.parent_id === parentId);
  if (children.length === 0) return null;

  return (
    <div className={`flex gap-6 ${parentId ? "mt-2" : ""} flex-wrap justify-center`}>
      {children.map((node) => (
        <NodeBox key={node.id} node={node}>
          {buildTree(nodes, node.id)}
        </NodeBox>
      ))}
    </div>
  );
}

function AreaFlow({ area, steps }: { area: string; steps: OrgChart["area_flows"][0]["steps"] }) {
  if (!steps.length) return null;
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <h4 className="font-semibold text-primary mb-4 flex items-center gap-2">
        <span className="w-3 h-3 rounded-full bg-primary" />
        Flujo detallado — {area}
      </h4>
      <div className="flex flex-wrap items-center gap-2">
        {steps.map((step, idx) => (
          <div key={step.id} className="flex items-center gap-2">
            <div className={`rounded-lg border px-3 py-2 min-w-[160px] max-w-[220px] ${
              step.is_automated ? "bg-teal-50 border-teal-300" : "bg-slate-50 border-slate-300"
            }`}>
              <p className="text-sm font-medium text-slate-800 leading-tight">{step.name}</p>
              <p className="text-xs text-slate-500 mt-1">{step.responsible}</p>
            </div>
            {idx < steps.length - 1 && (
              <svg width="24" height="16" viewBox="0 0 24 16" className="text-slate-400 shrink-0">
                <path d="M0 8 H18 M14 4 L20 8 L14 12" fill="none" stroke="currentColor" strokeWidth="2" />
              </svg>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function OrgChartViewer({ chart }: Props) {
  const root = chart.nodes.find((n) => n.type === "organization") || chart.nodes[0];

  return (
    <div className="space-y-8 p-4 overflow-y-auto h-full">
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h3 className="text-lg font-bold text-slate-800 mb-1">Organigrama — {chart.organization_name}</h3>
        <p className="text-sm text-slate-500 mb-6">
          Proceso: {chart.process_name}
          {chart.source_document && <> · Fuente: {chart.source_document}</>}
        </p>
        {root ? buildTree(chart.nodes, null) : (
          <p className="text-slate-400 text-center py-8">No hay estructura organizacional identificada aún.</p>
        )}
      </div>

      <div className="space-y-4">
        <h3 className="text-lg font-bold text-slate-800 px-1">Proceso detallado por área</h3>
        {chart.area_flows.length > 0 ? (
          chart.area_flows.map((flow) => (
            <AreaFlow key={flow.area} area={flow.area} steps={flow.steps} />
          ))
        ) : (
          <p className="text-slate-400 text-center py-8 bg-white rounded-xl border border-slate-200">
            Analiza la entrevista para generar los flujos por área.
          </p>
        )}
      </div>
    </div>
  );
}
