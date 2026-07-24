"use client";

type Content = Record<string, unknown>;

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function asString(v: unknown, fallback = ""): string {
  if (v == null) return fallback;
  return String(v);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h4 className="text-sm font-semibold text-slate-800 border-b border-slate-200 pb-1.5 mb-3">
        {title}
      </h4>
      {children}
    </div>
  );
}

function complianceBadge(status: string) {
  const normalized = status.toLowerCase();
  if (normalized.includes("cumple") && !normalized.includes("no")) {
    return "bg-success-muted text-success";
  }
  if (normalized.includes("parcial") || normalized.includes("por_verificar")) {
    return "bg-warning-muted text-warning";
  }
  return "bg-danger-muted text-danger";
}

function DataTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: React.ReactNode[][];
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-slate-500">Sin datos registrados aún.</p>;
  }
  return (
    <table className="w-full text-sm border border-slate-200 rounded-lg border-collapse table-fixed">
      <thead className="bg-slate-100 text-slate-600 text-left">
        <tr>
          {headers.map((h) => (
            <th key={h} className="p-2.5 font-semibold align-top break-words">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((cells, i) => (
          <tr key={i} className="border-t border-slate-100 align-top">
            {cells.map((cell, j) => (
              <td key={j} className="p-2.5 break-words whitespace-pre-wrap text-slate-700">
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ContextoOrganizacionView({ content }: { content: Content }) {
  const internal = asArray<Record<string, unknown>>(content.internal_context);
  const external = asArray<Record<string, unknown>>(content.external_context);
  return (
    <article className="space-y-5 text-sm">
      {asString(content.summary) && (
        <p className="text-slate-700 whitespace-pre-wrap break-words leading-relaxed">
          {asString(content.summary)}
        </p>
      )}
      <Section title="Contexto interno">
        {internal.length === 0 ? (
          <p className="text-slate-500">Sin factores internos registrados.</p>
        ) : (
          <ul className="space-y-3">
            {internal.map((item, i) => (
              <li key={i} className="border border-slate-200 rounded-lg p-4">
                <p className="font-medium text-slate-800 break-words">{asString(item.factor)}</p>
                <p className="text-slate-600 mt-1.5 whitespace-pre-wrap break-words leading-relaxed">
                  {asString(item.description)}
                </p>
                <p className="text-xs text-slate-500 mt-2 break-words">
                  Impacto: {asString(item.impact)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Contexto externo">
        {external.length === 0 ? (
          <p className="text-slate-500">Sin factores externos registrados.</p>
        ) : (
          <ul className="space-y-3">
            {external.map((item, i) => (
              <li key={i} className="border border-slate-200 rounded-lg p-4">
                <p className="font-medium text-slate-800 break-words">{asString(item.factor)}</p>
                <p className="text-slate-600 mt-1.5 whitespace-pre-wrap break-words leading-relaxed">
                  {asString(item.description)}
                </p>
                <p className="text-xs text-slate-500 mt-2 break-words">
                  Impacto: {asString(item.impact)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>
      {asString(content.monitoring_review) && (
        <p className="text-xs text-slate-500 italic border-t pt-3 whitespace-pre-wrap break-words">
          Revisión: {asString(content.monitoring_review)}
        </p>
      )}
    </article>
  );
}

export function AlcanceSgcView({ content }: { content: Content }) {
  return (
    <article className="space-y-5 text-sm">
      <div className="bg-primary-muted border border-primary/10 rounded-xl p-5">
        <p className="text-slate-800 leading-relaxed whitespace-pre-wrap break-words">
          {asString(content.scope_statement, "Alcance del SGC en elaboración.")}
        </p>
      </div>
      {asArray(content.products_services).length > 0 && (
        <Section title="Productos y servicios">
          <ul className="list-disc list-inside text-slate-700 space-y-1">
            {asArray(content.products_services).map((item, i) => (
              <li key={i} className="break-words">{String(item)}</li>
            ))}
          </ul>
        </Section>
      )}
      {asArray(content.locations).length > 0 && (
        <Section title="Ubicaciones">
          <ul className="list-disc list-inside text-slate-700 space-y-1">
            {asArray(content.locations).map((item, i) => (
              <li key={i} className="break-words">{String(item)}</li>
            ))}
          </ul>
        </Section>
      )}
      {asString(content.boundaries) && (
        <p className="break-words whitespace-pre-wrap">
          <span className="font-medium">Límites:</span> {asString(content.boundaries)}
        </p>
      )}
      {asString(content.applicability_notes) && (
        <p className="break-words whitespace-pre-wrap">
          <span className="font-medium">Aplicabilidad:</span> {asString(content.applicability_notes)}
        </p>
      )}
      {asArray<Record<string, unknown>>(content.exclusions).length > 0 && (
        <Section title="Exclusiones">
          <ul className="space-y-2">
            {asArray<Record<string, unknown>>(content.exclusions).map((ex, i) => (
              <li key={i} className="text-slate-700 break-words whitespace-pre-wrap">
                Cláusula {asString(ex.clause)}: {asString(ex.justification)}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </article>
  );
}

export function PartesInteresadasView({ content }: { content: Content }) {
  const stakeholders = asArray<Record<string, unknown>>(content.stakeholders);
  return (
    <DataTable
      headers={["Parte interesada", "Tipo", "Necesidades", "Expectativas", "Seguimiento"]}
      rows={stakeholders.map((s) => [
        <span key="n" className="font-medium">{asString(s.name)}</span>,
        asString(s.type),
        asArray(s.needs).join(", "),
        asArray(s.expectations).join(", "),
        asString(s.monitoring_method),
      ])}
    />
  );
}

export function CaracterizacionProcesosView({ content }: { content: Content }) {
  const items = asArray<Record<string, unknown>>(content.characterizations);
  if (!items.length) {
    return <p className="text-sm text-slate-500">Sin caracterizaciones definidas aún.</p>;
  }
  return (
    <div className="space-y-6">
      {items.map((proc, idx) => (
        <div key={idx} className="border border-slate-200 rounded-xl p-5 bg-white">
          <h4 className="font-bold text-slate-800 mb-3 break-words">
            {asString(proc.process_name)}
          </h4>
          <div className="grid sm:grid-cols-2 gap-3 text-sm text-slate-700">
            <p className="break-words whitespace-pre-wrap">
              <span className="font-medium">Objetivo:</span> {asString(proc.objective)}
            </p>
            <p className="break-words whitespace-pre-wrap">
              <span className="font-medium">Alcance:</span> {asString(proc.scope)}
            </p>
            <p className="break-words">
              <span className="font-medium">Responsable:</span> {asString(proc.owner)}
            </p>
          </div>
          {asArray(proc.inputs).length > 0 && (
            <Section title="Entradas">
              <ul className="list-disc list-inside text-sm text-slate-700 space-y-1">
                {asArray(proc.inputs).map((a, i) => (
                  <li key={i} className="break-words">{String(a)}</li>
                ))}
              </ul>
            </Section>
          )}
          {asArray(proc.outputs).length > 0 && (
            <Section title="Salidas">
              <ul className="list-disc list-inside text-sm text-slate-700 space-y-1">
                {asArray(proc.outputs).map((a, i) => (
                  <li key={i} className="break-words">{String(a)}</li>
                ))}
              </ul>
            </Section>
          )}
          {asArray(proc.main_activities).length > 0 && (
            <Section title="Actividades principales">
              <ol className="list-decimal list-inside text-sm text-slate-700 space-y-1">
                {asArray(proc.main_activities).map((a, i) => (
                  <li key={i} className="break-words">{String(a)}</li>
                ))}
              </ol>
            </Section>
          )}
        </div>
      ))}
    </div>
  );
}

export function CumplimientoLegalView({ content }: { content: Content }) {
  const rows = asArray<Record<string, unknown>>(content.requirements);
  return (
    <div className="space-y-3">
      {asString(content.summary) && (
        <p className="text-sm text-slate-700 whitespace-pre-wrap break-words mb-4">
          {asString(content.summary)}
        </p>
      )}
      <DataTable
        headers={["Ley / norma", "Requisito", "Cumplimiento", "Evidencia", "Responsable"]}
        rows={rows.map((r) => [
          <span key="l" className="font-medium">{asString(r.law_or_regulation)}</span>,
          asString(r.requirement_summary),
          <span
            key="c"
            className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${complianceBadge(asString(r.compliance_status))}`}
          >
            {asString(r.compliance_status, "por_verificar")}
          </span>,
          asString(r.evidence),
          asString(r.responsible),
        ])}
      />
    </div>
  );
}

export function ObjetivosCalidadView({ content }: { content: Content }) {
  const objectives = asArray<Record<string, unknown>>(content.objectives);
  return (
    <div className="space-y-3">
      <DataTable
        headers={["Objetivo", "Indicador", "Meta", "Plazo", "Responsable", "Proceso"]}
        rows={objectives.map((o) => [
          <span key="o" className="font-medium">{asString(o.objective)}</span>,
          asString(o.indicator),
          asString(o.target),
          asString(o.deadline),
          asString(o.responsible),
          asString(o.linked_process),
        ])}
      />
      {asString(content.alignment_with_policy) && (
        <p className="text-xs text-slate-500 mt-3 italic whitespace-pre-wrap break-words">
          {asString(content.alignment_with_policy)}
        </p>
      )}
    </div>
  );
}

export function RegistrosRequeridosView({ content }: { content: Content }) {
  const records = asArray<Record<string, unknown>>(content.records);
  return (
    <div className="space-y-3">
      {asString(content.summary) && (
        <p className="text-sm text-slate-700 whitespace-pre-wrap break-words mb-4">
          {asString(content.summary)}
        </p>
      )}
      <DataTable
        headers={["Código", "Registro", "Cláusula", "Proceso", "Conservación", "Responsable"]}
        rows={records.map((r) => [
          <span key="c" className="font-mono text-xs">{asString(r.code)}</span>,
          <span key="n" className="font-medium">{asString(r.name)}</span>,
          asString(r.related_clause),
          asString(r.related_process),
          asString(r.retention_period),
          asString(r.responsible),
        ])}
      />
    </div>
  );
}
