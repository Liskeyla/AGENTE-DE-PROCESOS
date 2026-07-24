"use client";

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

const LANE_PALETTE = [
  { bg: "#dbeafe", border: "#93c5fd", label: "#1d4ed8", bar: "#2563eb" },
  { bg: "#dcfce7", border: "#86efac", label: "#15803d", bar: "#16a34a" },
  { bg: "#ffedd5", border: "#fdba74", label: "#c2410c", bar: "#ea580c" },
  { bg: "#fef9c3", border: "#fde047", label: "#a16207", bar: "#ca8a04" },
  { bg: "#f3e8ff", border: "#d8b4fe", label: "#7e22ce", bar: "#9333ea" },
  { bg: "#e0f2fe", border: "#7dd3fc", label: "#0369a1", bar: "#0284c7" },
];

const COL_W = 200;
const LANE_LABEL_W = 168;

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

function PersonIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden className="shrink-0">
      <circle cx="12" cy="8" r="3.5" stroke="#2b579a" strokeWidth="1.8" />
      <path d="M5 19c1.5-3.5 4-5 7-5s5.5 1.5 7 5" stroke="#2b579a" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden className="shrink-0">
      <circle cx="12" cy="12" r="3" stroke="#475569" strokeWidth="1.8" />
      <path
        d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8"
        stroke="#475569"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function statusTone(note: string): string {
  const n = note.toLowerCase();
  if (n.includes("aprob") || n.includes("confirm")) return "border-emerald-400 bg-emerald-50 text-emerald-800";
  if (n.includes("rechaz") || n.includes("error")) return "border-red-400 bg-red-50 text-red-800";
  if (n.includes("pend") || n.includes("revis")) return "border-amber-400 bg-amber-50 text-amber-900";
  if (n.includes("enviad")) return "border-sky-400 bg-sky-50 text-sky-900";
  return "border-slate-300 bg-slate-50 text-slate-700";
}

function StartChip({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5 max-w-[160px]">
      <div
        className="w-11 h-11 rounded-full border-[3px] flex items-center justify-center text-[10px] font-bold"
        style={{ backgroundColor: BIZAGI.startFill, borderColor: BIZAGI.startBorder, color: BIZAGI.startBorder }}
      >
        Inicio
      </div>
      <p className="text-[10px] text-slate-600 text-center leading-tight break-words">{label}</p>
    </div>
  );
}

function EndChip({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5 max-w-[160px]">
      <div
        className="w-11 h-11 rounded-full border-[4px] flex items-center justify-center text-[10px] font-bold"
        style={{ backgroundColor: BIZAGI.endFill, borderColor: BIZAGI.endBorder, color: BIZAGI.endBorder }}
      >
        Fin
      </div>
      <p className="text-[10px] text-slate-600 text-center leading-tight break-words">{label}</p>
    </div>
  );
}

function ActivityCard({
  number,
  name,
  type,
  statusNote,
}: {
  number: number;
  name: string;
  type: string;
  statusNote?: string;
}) {
  const isSystem = type === "system";
  const isDecision = type === "decision";
  if (isDecision) {
    return (
      <div className="flex flex-col items-center gap-1.5 max-w-[170px]">
        <div
          className="w-14 h-14 rotate-45 border-2 flex items-center justify-center shadow-sm"
          style={{ backgroundColor: BIZAGI.gatewayFill, borderColor: BIZAGI.gatewayBorder }}
        >
          <span className="-rotate-45 text-[10px] font-bold text-amber-900">?</span>
        </div>
        <p className="text-[11px] font-semibold text-slate-800 text-center leading-snug break-words">
          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#1e3a5f] text-white text-[10px] mr-1 align-middle">
            {number}
          </span>
          {name}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-1.5 w-[176px]">
      <div
        className="relative w-full rounded-lg border-2 bg-white px-3 py-2.5 shadow-sm text-left"
        style={{ borderColor: isSystem ? "#64748b" : BIZAGI.taskBorder }}
      >
        <div className="flex items-start gap-2">
          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#1e3a5f] text-white text-[10px] font-bold shrink-0">
            {number}
          </span>
          {isSystem ? <GearIcon /> : <PersonIcon />}
        </div>
        <p className="text-[11px] font-semibold text-slate-800 leading-snug mt-1.5 break-words whitespace-pre-wrap">
          {name}
        </p>
      </div>
      {statusNote ? (
        <span className={`text-[9px] font-medium px-2 py-0.5 rounded border break-words text-center ${statusTone(statusNote)}`}>
          {statusNote}
        </span>
      ) : null}
    </div>
  );
}

function FlowLegend() {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[10px] text-slate-600 border border-slate-200 rounded-lg bg-white px-3 py-2">
      <span className="font-bold text-slate-700 uppercase tracking-wide">Leyenda</span>
      <span className="inline-flex items-center gap-1.5">
        <span className="w-3.5 h-3.5 rounded-full border-2 border-emerald-600 bg-emerald-50" /> Inicio
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="w-3.5 h-3.5 rounded-full border-[3px] border-red-600 bg-red-50" /> Fin
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="w-5 h-3.5 rounded border-2 border-blue-700 bg-white" /> Actividad
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="w-3.5 h-3.5 rotate-45 border-2 border-amber-500 bg-amber-50" /> Decisión
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="w-5 h-3.5 rounded border-2 border-slate-500 bg-white" /> Sistema
      </span>
    </div>
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
        const processName = asString(d.process_name, `Proceso ${idx + 1}`);
        const sequence = asArray<string>(d.sequence);
        const activities = asArray<Record<string, unknown>>(d.activities);
        const decisions = asArray<Record<string, unknown>>(d.decisions);
        const actMap = Object.fromEntries(activities.map((a) => [asString(a.id), a]));
        const steps = (sequence.length ? sequence : activities.map((a) => asString(a.id))).filter(
          (id) => actMap[asString(id)],
        );

        const laneOrder: string[] = [];
        steps.forEach((stepId) => {
          const act = actMap[asString(stepId)];
          const lane = asString(act?.responsible, "General") || "General";
          if (!laneOrder.includes(lane)) laneOrder.push(lane);
        });
        if (!laneOrder.length) laneOrder.push("General");

        const decisionAfter = new Map<string, Record<string, unknown>>();
        decisions.forEach((dec) => {
          const after = asString(dec.after);
          if (after) decisionAfter.set(after, dec);
        });

        const cols = steps.length + 2; // start + steps + end
        const gridWidth = LANE_LABEL_W + cols * COL_W;

        return (
          <div
            key={idx}
            className="bizagi-export-block rounded-lg border-2 bg-white shadow-sm"
            style={{ borderColor: BIZAGI.poolBorder }}
            data-diagram-index={idx}
            data-process-name={processName}
          >
            <PoolHeader
              title={`Diagrama de flujo TO BE: ${processName}`}
              organizationName={organizationName}
            />
            <div className="p-4 bg-[#f7f9fc]">
              <div className="overflow-x-auto pb-2">
                <div
                  className="bizagi-flow-sequence inline-block min-w-full"
                  style={{ width: gridWidth }}
                >
                  {laneOrder.map((lane, li) => {
                    const palette = LANE_PALETTE[li % LANE_PALETTE.length];
                    return (
                      <div
                        key={lane}
                        className="bizagi-lane-row flex border border-slate-200 mb-[-1px] last:mb-0"
                        style={{ backgroundColor: palette.bg }}
                      >
                        <div
                          className="bizagi-lane-label shrink-0 px-3 py-4 text-[11px] font-bold flex items-center border-r break-words leading-snug"
                          style={{
                            width: LANE_LABEL_W,
                            minWidth: LANE_LABEL_W,
                            backgroundColor: palette.bar,
                            color: "#fff",
                            borderColor: palette.border,
                          }}
                        >
                          {lane}
                        </div>

                        {/* Start */}
                        <div
                          className="bizagi-lane-steps flex items-center justify-center gap-1 px-2 py-4 border-r border-slate-200/80"
                          style={{ width: COL_W, minWidth: COL_W }}
                        >
                          {li === 0 ? (
                            <>
                              <StartChip label={asString(d.start_event, "Inicio del proceso")} />
                              <ArrowRight width={28} />
                            </>
                          ) : (
                            <div className="w-full h-px border-t border-dashed border-slate-300/80" />
                          )}
                        </div>

                        {steps.map((stepId, si) => {
                          const act = actMap[asString(stepId)];
                          const actLane = asString(act?.responsible, "General") || "General";
                          const here = actLane === lane;
                          const type = asString(act?.type, "task").toLowerCase();
                          const dec = decisionAfter.get(asString(stepId));
                          const nextId = si < steps.length - 1 ? asString(steps[si + 1]) : null;
                          const nextAct = nextId ? actMap[nextId] : null;
                          const nextLane = nextAct
                            ? asString(nextAct.responsible, "General") || "General"
                            : laneOrder[0];
                          const showArrow = here && (nextId || si === steps.length - 1);

                          return (
                            <div
                              key={`${lane}-${stepId}`}
                              className="flex items-center justify-center gap-1 px-1.5 py-4 border-r border-slate-200/80"
                              style={{ width: COL_W, minWidth: COL_W }}
                            >
                              {here ? (
                                <>
                                  <ActivityCard
                                    number={si + 1}
                                    name={asString(act?.name)}
                                    type={type}
                                    statusNote={
                                      act?.status_note != null && String(act.status_note).trim()
                                        ? asString(act.status_note)
                                        : undefined
                                    }
                                  />
                                  {dec && type === "decision" ? (
                                    <div className="flex flex-col gap-0.5 text-[8px] font-semibold text-amber-800 leading-tight">
                                      <span>{asString(dec.yes_label, "Sí")}↓</span>
                                      <span>{asString(dec.no_label, "No")}→</span>
                                    </div>
                                  ) : showArrow ? (
                                    <ArrowRight width={24} />
                                  ) : null}
                                </>
                              ) : nextLane === lane && si > 0 && asString(actMap[asString(steps[si - 1])]?.responsible) !== lane ? (
                                <div className="flex flex-col items-center gap-0.5 opacity-70">
                                  <ArrowDown />
                                  <span className="text-[8px] text-slate-500">flujo</span>
                                </div>
                              ) : (
                                <div className="w-full h-px border-t border-dashed border-slate-300/70" />
                              )}
                            </div>
                          );
                        })}

                        {/* End */}
                        <div
                          className="flex items-center justify-center px-2 py-4"
                          style={{ width: COL_W, minWidth: COL_W }}
                        >
                          {li === 0 ? (
                            <EndChip label={asString(d.end_event, "Fin del proceso")} />
                          ) : (
                            <div className="w-full h-px border-t border-dashed border-slate-300/80" />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {decisions.length > 0 && (
                <div className="mt-4 grid sm:grid-cols-2 gap-2">
                  {decisions.map((dec, di) => (
                    <div
                      key={di}
                      className="text-xs bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 break-words"
                    >
                      <span className="font-semibold text-amber-900">Decisión:</span>{" "}
                      {asString(dec.question)}
                      <span className="text-slate-600">
                        {" "}
                        → {asString(dec.yes_label, "Sí")}: {asString(dec.yes_to)} ·{" "}
                        {asString(dec.no_label, "No")}: {asString(dec.no_to)}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <FlowLegend />
            </div>
          </div>
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
      <PoolHeader title="Mapa de procesos" organizationName={organizationName} />
      <div className="p-5 bg-[#fafbfd] space-y-4">
        {content.summary != null && content.summary !== "" && (
          <p className="text-sm text-slate-600 bg-blue-50 border border-blue-100 rounded-lg p-3 whitespace-pre-wrap break-words">
            {asString(content.summary)}
          </p>
        )}

        {bands.map(({ key, label, color }) => {
          const items = byType[key];
          if (!items.length) return null;
          return (
            <div key={key} className="rounded-lg border" style={{ borderColor: color }}>
              <div className="px-4 py-2 text-white text-xs font-bold uppercase tracking-wide" style={{ backgroundColor: color }}>
                {label}
              </div>
              <div className="p-4 flex flex-wrap items-stretch gap-3 bg-white">
                {items.map((p, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div
                      className="rounded-lg border-2 px-4 py-3 min-w-[160px] max-w-[240px] shadow-sm"
                      style={{ borderColor: color, backgroundColor: "#fff" }}
                    >
                      <p className="text-sm font-bold text-slate-800 break-words">{asString(p.name)}</p>
                      <p className="text-[10px] text-slate-500 mt-1 break-words">Responsable: {asString(p.owner, "Por definir")}</p>
                      {asArray(p.inputs).length > 0 && (
                        <p className="text-[10px] text-slate-500 mt-1 break-words">
                          Entradas: {asArray(p.inputs).join(", ")}
                        </p>
                      )}
                      {asArray(p.outputs).length > 0 && (
                        <p className="text-[10px] text-slate-500 break-words">
                          Salidas: {asArray(p.outputs).join(", ")}
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

function OrgNode({
  title,
  name,
  area,
}: {
  title: string;
  name: string;
  area?: string;
}) {
  return (
    <div
      className="rounded-md border-2 px-4 py-3 min-w-[170px] max-w-[220px] text-center shadow-sm"
      style={{ backgroundColor: BIZAGI.orgNode, borderColor: BIZAGI.orgBorder }}
    >
      <p className="text-[10px] font-bold uppercase tracking-wide text-primary">{title}</p>
      <p className="text-sm font-semibold text-slate-800 mt-1">{name}</p>
      {area ? <p className="text-[10px] text-slate-500 mt-1">{area}</p> : null}
    </div>
  );
}

function OrgTree({
  nodes,
  parentId,
}: {
  nodes: Array<Record<string, unknown>>;
  parentId: string;
}) {
  const children = nodes.filter((n) => {
    const pid = n.parent_id == null ? "root" : asString(n.parent_id);
    return pid === parentId;
  });
  if (!children.length) return null;

  return (
    <div className="flex flex-col items-center">
      <div className="flex flex-wrap justify-center gap-8">
        {children.map((n) => (
          <div key={asString(n.id)} className="flex flex-col items-center">
            <OrgNode
              title={asString(n.title)}
              name={asString(n.name)}
              area={n.area != null ? asString(n.area) : undefined}
            />
            <ArrowDown />
            <OrgTree nodes={nodes} parentId={asString(n.id)} />
          </div>
        ))}
      </div>
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

  return (
    <div
      className="bizagi-export-block rounded-lg border-2 bg-white shadow-sm"
      style={{ borderColor: BIZAGI.poolBorder }}
    >
      <PoolHeader title="Organigrama organizacional" organizationName={orgName} />
      <div className="p-6 bg-[#fafbfd]">
        {content.summary != null && content.summary !== "" && (
          <p className="text-sm text-slate-600 text-center mb-6 max-w-2xl mx-auto whitespace-pre-wrap break-words">
            {asString(content.summary)}
          </p>
        )}
        <div className="py-4 flex justify-center">
          <OrgTree nodes={nodes} parentId="root" />
        </div>

        {nodes.some((n) => asArray(n.responsibilities).length > 0) && (
          <div className="mt-8 border-t border-slate-200 pt-6">
            <p className="text-xs font-bold text-slate-600 uppercase mb-3">Responsabilidades por cargo</p>
            <div className="grid sm:grid-cols-2 gap-3">
              {nodes
                .filter((n) => asArray(n.responsibilities).length > 0)
                .map((n, i) => (
                  <div key={i} className="text-xs border border-slate-200 rounded-lg p-3 bg-white">
                    <p className="font-semibold text-slate-800 break-words">
                      {asString(n.title)} — {asString(n.name)}
                    </p>
                    <ul className="list-disc list-inside text-slate-600 mt-1 space-y-0.5">
                      {asArray(n.responsibilities).map((r, ri) => (
                        <li key={ri} className="break-words">{String(r)}</li>
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
