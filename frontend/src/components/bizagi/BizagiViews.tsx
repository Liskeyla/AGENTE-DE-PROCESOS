"use client";

import { FlowDiagramCanvas } from "@/components/bizagi/FlowDiagramCanvas";
import type { FlowDiagramInput } from "@/lib/flowDiagram/types";

type Content = Record<string, unknown>;

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function asString(v: unknown, fallback = ""): string {
  if (v == null) return fallback;
  return String(v);
}

const BIZAGI = {
  poolBorder: "#1e3a5f",
  laneHeader: "#e8f0fe",
  laneBorder: "#b8c9e0",
  taskFill: "#ffffff",
  taskBorder: "#2b579a",
  taskText: "#1a1a1a",
  startFill: "#e8f5e9",
  startBorder: "#2e7d32",
  endFill: "#ffebee",
  endBorder: "#c62828",
  gatewayFill: "#fff8e1",
  gatewayBorder: "#f57c00",
  arrow: "#455a64",
  strategic: "#1e3a5f",
  misional: "#1565c0",
  apoyo: "#546e7a",
  orgNode: "#f5f9ff",
  orgBorder: "#2b579a",
};

function ArrowRight({ width = 36 }: { width?: number }) {
  return (
    <svg width={width} height={20} viewBox="0 0 48 24" className="shrink-0" aria-hidden>
      <path
        d="M4 12 H38 M32 6 L40 12 L32 18"
        fill="none"
        stroke={BIZAGI.arrow}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ArrowDown() {
  return (
    <svg width={24} height={36} viewBox="0 0 24 36" className="shrink-0" aria-hidden>
      <path
        d="M12 4 V28 M6 22 L12 30 L18 22"
        fill="none"
        stroke={BIZAGI.arrow}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PoolHeader({ title, organizationName }: { title: string; organizationName?: string }) {
  return (
    <div
      className="px-4 py-2.5 text-white text-sm font-bold rounded-t-lg"
      style={{ backgroundColor: BIZAGI.poolBorder }}
    >
      {title}
      {organizationName ? ` — ${organizationName}` : ""}
    </div>
  );
}

export function BizagiFlowDiagram({
  content,
  organizationName,
}: {
  content: Content;
  organizationName?: string;
}) {
  const diagrams = asArray<Record<string, unknown>>(content.diagrams);

  if (!diagrams.length) {
    return <p className="text-sm text-slate-500">Sin diagramas de flujo definidos.</p>;
  }

  return (
    <div className="space-y-12">
      {diagrams.map((d, idx) => {
        const activities = asArray<Record<string, unknown>>(d.activities).map((a) => ({
          id: asString(a.id),
          name: asString(a.name),
          responsible: asString(a.responsible, "General") || "General",
          type: asString(a.type, "task"),
          status_note:
            a.status_note != null && String(a.status_note).trim()
              ? asString(a.status_note)
              : undefined,
        }));

        const input: FlowDiagramInput = {
          process_name: asString(d.process_name, `Proceso ${idx + 1}`),
          start_event: asString(d.start_event, "Inicio del proceso"),
          end_event: asString(d.end_event, "Fin del proceso"),
          mode: asString(d.mode, asString(content.mode, "to_be")),
          activities,
          sequence: asArray<string>(d.sequence).map(String),
          decisions: asArray<Record<string, unknown>>(d.decisions).map((dec) => ({
            after: asString(dec.after),
            question: asString(dec.question),
            yes_to: asString(dec.yes_to) || undefined,
            no_to: asString(dec.no_to) || undefined,
            yes_label: asString(dec.yes_label, "Sí"),
            no_label: asString(dec.no_label, "No"),
          })),
        };

        return (
          <FlowDiagramCanvas
            key={idx}
            diagram={input}
            organizationName={organizationName}
          />
        );
      })}
    </div>
  );
}

export function BizagiProcessMap({
  content,
  organizationName,
}: {
  content: Content;
  organizationName?: string;
}) {
  const processes = asArray<Record<string, unknown>>(content.processes);
  const byType: Record<string, typeof processes> = { estrategico: [], misional: [], apoyo: [] };
  processes.forEach((p) => {
    const t = asString(p.type, "misional").toLowerCase();
    const key = t.includes("estrat") ? "estrategico" : t.includes("apoyo") ? "apoyo" : "misional";
    byType[key].push(p);
  });

  const bands = [
    { key: "estrategico", label: "Procesos estratégicos", color: BIZAGI.strategic },
    { key: "misional", label: "Procesos misionales", color: BIZAGI.misional },
    { key: "apoyo", label: "Procesos de apoyo", color: BIZAGI.apoyo },
  ] as const;

  return (
    <div
      className="bizagi-export-block rounded-lg border-2 bg-white shadow-sm"
      style={{ borderColor: BIZAGI.poolBorder }}
    >
      <PoolHeader title="Mapa de procesos" />
      <div className="p-5 bg-[#fafbfd] space-y-4">
        {content.summary != null && content.summary !== "" && (
          <p className="text-sm text-slate-700 bg-blue-50 border border-blue-100 rounded-lg p-3.5 whitespace-pre-wrap break-words leading-relaxed">
            {asString(content.summary)}
          </p>
        )}

        {bands.map(({ key, label, color }) => {
          const items = byType[key];
          if (!items.length) return null;
          return (
            <div key={key} className="rounded-lg border" style={{ borderColor: color }}>
              <div className="px-4 py-2.5 text-white text-xs font-bold uppercase tracking-wide" style={{ backgroundColor: color }}>
                {label}
              </div>
              <div className="p-4 flex flex-wrap items-stretch gap-3 bg-white">
                {items.map((p, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div
                      className="rounded-lg border-2 px-4 py-3.5 min-w-[180px] max-w-[260px] shadow-sm"
                      style={{ borderColor: color, backgroundColor: "#fff" }}
                    >
                      <p className="text-[15px] font-bold text-slate-800 break-words leading-snug">{asString(p.name)}</p>
                      <p className="text-xs text-slate-600 mt-2 break-words">
                        <span className="font-semibold">Responsable:</span> {asString(p.owner, "Por definir")}
                      </p>
                      {asArray(p.inputs).length > 0 && (
                        <p className="text-xs text-slate-600 mt-1.5 break-words leading-relaxed">
                          <span className="font-semibold">Entradas:</span> {asArray(p.inputs).join(", ")}
                        </p>
                      )}
                      {asArray(p.outputs).length > 0 && (
                        <p className="text-xs text-slate-600 mt-1 break-words leading-relaxed">
                          <span className="font-semibold">Salidas:</span> {asArray(p.outputs).join(", ")}
                        </p>
                      )}
                    </div>
                    {i < items.length - 1 && <ArrowRight width={32} />}
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        {processes.some((p) => asArray(p.related_processes).length > 0) && (
          <div className="mt-2 p-4 bg-slate-50 rounded-lg border border-slate-200">
            <p className="text-xs font-bold text-slate-600 uppercase mb-3">Interrelación entre procesos</p>
            <div className="space-y-2">
              {processes
                .filter((p) => asArray(p.related_processes).length > 0)
                .map((p, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-semibold px-2 py-1 rounded border border-slate-300 bg-white">
                      {asString(p.name)}
                    </span>
                    <ArrowRight width={28} />
                    {asArray(p.related_processes).map((rel, ri) => (
                      <span
                        key={ri}
                        className="px-2 py-1 rounded border border-blue-200 bg-blue-50 text-blue-900"
                      >
                        {String(rel)}
                      </span>
                    ))}
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function OrgNodeCard({
  title,
  name,
  area,
  level = 2,
}: {
  title: string;
  name: string;
  area?: string;
  level?: number;
}) {
  const isRoot = level <= 1;
  return (
    <div
      className="rounded-lg border-2 px-4 py-3 min-w-[160px] max-w-[220px] text-center shadow-sm relative z-[1]"
      style={{
        backgroundColor: isRoot ? "#1e3a5f" : BIZAGI.orgNode,
        borderColor: isRoot ? "#1e3a5f" : BIZAGI.orgBorder,
        color: isRoot ? "#fff" : undefined,
      }}
    >
      <p
        className={`text-[10px] font-bold uppercase tracking-wide ${
          isRoot ? "text-white/80" : "text-primary"
        }`}
      >
        {title}
      </p>
      <p className={`text-sm font-semibold mt-1 break-words ${isRoot ? "text-white" : "text-slate-800"}`}>
        {name}
      </p>
      {area ? (
        <p className={`text-[10px] mt-1 break-words ${isRoot ? "text-white/70" : "text-slate-500"}`}>
          {area}
        </p>
      ) : null}
    </div>
  );
}

function normalizeParentId(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s || s === "root" || s === "null" || s === "undefined" || s === "none") {
    return null;
  }
  return s;
}

function getOrgChildren(
  nodes: Array<Record<string, unknown>>,
  parentId: string | null,
): Array<Record<string, unknown>> {
  return nodes.filter((n) => normalizeParentId(n.parent_id) === parentId);
}

function findOrgRoots(nodes: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const ids = new Set(nodes.map((n) => asString(n.id)).filter(Boolean));
  const roots = nodes.filter((n) => {
    const pid = normalizeParentId(n.parent_id);
    if (pid == null) return true;
    // Huérfanos cuyo padre no existe → tratar como raíz
    return !ids.has(pid);
  });
  if (roots.length) return roots;

  // Fallback: nivel más bajo
  const levels = nodes
    .map((n) => Number(n.level))
    .filter((l) => Number.isFinite(l));
  if (levels.length) {
    const min = Math.min(...levels);
    return nodes.filter((n) => Number(n.level) === min);
  }
  return nodes.slice(0, 1);
}

/** Subárbol con conectores ortogonales (líneas que unen padre e hijos). */
function OrgSubtree({
  node,
  nodes,
  depth = 0,
}: {
  node: Record<string, unknown>;
  nodes: Array<Record<string, unknown>>;
  depth?: number;
}) {
  const id = asString(node.id);
  const children = getOrgChildren(nodes, id);
  const level = Number(node.level);
  const resolvedLevel = Number.isFinite(level) ? level : depth + 1;

  return (
    <div className="flex flex-col items-center">
      <OrgNodeCard
        title={asString(node.title, "Cargo")}
        name={asString(node.name, "Por definir")}
        area={node.area != null ? asString(node.area) : undefined}
        level={resolvedLevel}
      />

      {children.length > 0 ? (
        <>
          {/* Línea vertical desde el padre */}
          <div
            className="w-0.5 h-5 shrink-0"
            style={{ backgroundColor: "#94a3b8" }}
            aria-hidden
          />

          {/* Contenedor de hijos con barra horizontal de unión */}
          <div className="flex items-start justify-center">
            {children.map((child, index) => {
              const isFirst = index === 0;
              const isLast = index === children.length - 1;
              const alone = children.length === 1;

              return (
                <div
                  key={asString(child.id) || index}
                  className="flex flex-col items-center px-3 sm:px-4 relative"
                >
                  {/* Segmentos de la barra horizontal entre hermanos */}
                  {!alone ? (
                    <div
                      className="absolute top-0 h-0.5"
                      style={{
                        backgroundColor: "#94a3b8",
                        left: isFirst ? "50%" : 0,
                        right: isLast ? "50%" : 0,
                      }}
                      aria-hidden
                    />
                  ) : null}
                  {/* Baja vertical hacia cada hijo */}
                  <div
                    className="w-0.5 h-5 shrink-0"
                    style={{ backgroundColor: "#94a3b8" }}
                    aria-hidden
                  />
                  <OrgSubtree node={child} nodes={nodes} depth={depth + 1} />
                </div>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}

export function BizagiOrgChart({
  content,
  organizationName,
}: {
  content: Content;
  organizationName?: string;
}) {
  const nodes = asArray<Record<string, unknown>>(content.nodes);
  const orgName = asString(content.organization_name, organizationName || "Organización");
  const roots = findOrgRoots(nodes);

  return (
    <div
      className="bizagi-export-block rounded-lg border-2 bg-white shadow-sm"
      style={{ borderColor: BIZAGI.poolBorder }}
    >
      <PoolHeader title="Organigrama funcional" organizationName={orgName} />
      <div className="p-6 bg-[#fafbfd]">
        {content.summary != null && content.summary !== "" && (
          <p className="text-sm text-slate-600 text-center mb-6 max-w-2xl mx-auto whitespace-pre-wrap break-words">
            {asString(content.summary)}
          </p>
        )}

        {nodes.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-8">
            Sin estructura organizacional definida aún.
          </p>
        ) : (
          <div className="py-4 overflow-x-auto">
            <div className="inline-flex min-w-full justify-center gap-10 px-2">
              {roots.map((root, i) => (
                <OrgSubtree
                  key={asString(root.id) || `root-${i}`}
                  node={root}
                  nodes={nodes}
                  depth={0}
                />
              ))}
            </div>
          </div>
        )}

        {nodes.some((n) => asArray(n.responsibilities).length > 0) && (
          <div className="mt-8 border-t border-slate-200 pt-6">
            <p className="text-xs font-bold text-slate-600 uppercase mb-3">
              Responsabilidades por cargo
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
              {nodes
                .filter((n) => asArray(n.responsibilities).length > 0)
                .map((n, i) => (
                  <div
                    key={asString(n.id) || i}
                    className="text-xs border border-slate-200 rounded-lg p-3 bg-white"
                  >
                    <p className="font-semibold text-slate-800 break-words">
                      {asString(n.title)} — {asString(n.name)}
                    </p>
                    <ul className="list-disc list-inside text-slate-600 mt-1 space-y-0.5">
                      {asArray(n.responsibilities).map((r, ri) => (
                        <li key={ri} className="break-words">
                          {String(r)}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
