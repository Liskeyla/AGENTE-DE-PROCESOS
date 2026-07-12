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
    <div className="mb-5">
      <h4 className="text-sm font-semibold text-slate-800 border-b border-slate-200 pb-1 mb-2">{title}</h4>
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

export function ContextoOrganizacionView({ content }: { content: Content }) {
  const internal = asArray<Record<string, unknown>>(content.internal_context);
  const external = asArray<Record<string, unknown>>(content.external_context);
  return (
    <article className="space-y-5 text-sm">
      {asString(content.summary) && (
        <p className="text-slate-700">{asString(content.summary)}</p>
      )}
      <Section title="Contexto interno">
        {internal.length === 0 ? (
          <p className="text-slate-500">Sin factores internos registrados.</p>
        ) : (
          <ul className="space-y-2">
            {internal.map((item, i) => (
              <li key={i} className="border border-slate-200 rounded-lg p-3">
                <p className="font-medium text-slate-800">{asString(item.factor)}</p>
                <p className="text-slate-600 mt-1">{asString(item.description)}</p>
                <p className="text-xs text-slate-500 mt-1">Impacto: {asString(item.impact)}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Contexto externo">
        {external.length === 0 ? (
          <p className="text-slate-500">Sin factores externos registrados.</p>
        ) : (
          <ul className="space-y-2">
            {external.map((item, i) => (
              <li key={i} className="border border-slate-200 rounded-lg p-3">
                <p className="font-medium text-slate-800">{asString(item.factor)}</p>
                <p className="text-slate-600 mt-1">{asString(item.description)}</p>
                <p className="text-xs text-slate-500 mt-1">Impacto: {asString(item.impact)}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>
      {asString(content.monitoring_review) && (
        <p className="text-xs text-slate-500 italic border-t pt-3">
          Revisión: {asString(content.monitoring_review)}
        </p>
      )}
    </article>
  );
}

export function AlcanceSgcView({ content }: { content: Content }) {
  return (
    <article className="space-y-4 text-sm">
      <div className="bg-primary-muted border border-primary/10 rounded-xl p-5">
        <p className="text-slate-800 leading-relaxed whitespace-pre-wrap">
          {asString(content.scope_statement, "Alcance del SGC en elaboración.")}
        </p>
      </div>
      {asArray(content.products_services).length > 0 && (
        <Section title="Productos y servicios">
          <ul className="list-disc list-inside text-slate-700">
            {asArray(content.products_services).map((item, i) => <li key={i}>{String(item)}</li>)}
          </ul>
        </Section>
      )}
      {asArray(content.locations).length > 0 && (
        <Section title="Ubicaciones">
          <ul className="list-disc list-inside text-slate-700">
            {asArray(content.locations).map((item, i) => <li key={i}>{String(item)}</li>)}
          </ul>
        </Section>
      )}
      {asString(content.boundaries) && (
        <p><span className="font-medium">Límites:</span> {asString(content.boundaries)}</p>
      )}
      {asArray<Record<string, unknown>>(content.exclusions).length > 0 && (
        <Section title="Exclusiones">
          <ul className="space-y-2">
            {asArray<Record<string, unknown>>(content.exclusions).map((ex, i) => (
              <li key={i} className="text-slate-700">
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
    <div className="overflow-x-auto">
      <table className="w-full text-sm border border-slate-200 rounded-lg">
        <thead className="bg-slate-100 text-slate-600 text-left">
          <tr>
            <th className="p-2">Parte interesada</th>
            <th className="p-2">Tipo</th>
            <th className="p-2">Necesidades</th>
            <th className="p-2">Expectativas</th>
            <th className="p-2">Seguimiento</th>
          </tr>
        </thead>
        <tbody>
          {stakeholders.map((s, i) => (
            <tr key={i} className="border-t border-slate-100 align-top">
              <td className="p-2 font-medium">{asString(s.name)}</td>
              <td className="p-2 capitalize">{asString(s.type)}</td>
              <td className="p-2 text-xs">{asArray(s.needs).join(", ")}</td>
              <td className="p-2 text-xs">{asArray(s.expectations).join(", ")}</td>
              <td className="p-2 text-xs">{asString(s.monitoring_method)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CaracterizacionProcesosView({ content }: { content: Content }) {
  const items = asArray<Record<string, unknown>>(content.characterizations);
  return (
    <div className="space-y-6">
      {items.map((proc, idx) => (
        <div key={idx} className="border border-slate-200 rounded-xl p-5 bg-white">
          <h4 className="font-bold text-slate-800 mb-3">{asString(proc.process_name)}</h4>
          <div className="grid sm:grid-cols-2 gap-2 text-sm text-slate-700">
            <p><span className="font-medium">Objetivo:</span> {asString(proc.objective)}</p>
            <p><span className="font-medium">Alcance:</span> {asString(proc.scope)}</p>
            <p><span className="font-medium">Responsable:</span> {asString(proc.owner)}</p>
          </div>
          {asArray(proc.main_activities).length > 0 && (
            <Section title="Actividades principales">
              <ol className="list-decimal list-inside text-sm text-slate-700">
                {asArray(proc.main_activities).map((a, i) => <li key={i}>{String(a)}</li>)}
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
    <div className="overflow-x-auto">
      <table className="w-full text-sm border border-slate-200 rounded-lg">
        <thead className="bg-slate-100 text-slate-600 text-left">
          <tr>
            <th className="p-2">Ley / norma</th>
            <th className="p-2">Requisito</th>
            <th className="p-2">Cumplimiento</th>
            <th className="p-2">Evidencia</th>
            <th className="p-2">Responsable</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-slate-100 align-top">
              <td className="p-2 font-medium">{asString(r.law_or_regulation)}</td>
              <td className="p-2 text-xs">{asString(r.requirement_summary)}</td>
              <td className="p-2">
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${complianceBadge(asString(r.compliance_status))}`}>
                  {asString(r.compliance_status, "por_verificar")}
                </span>
              </td>
              <td className="p-2 text-xs">{asString(r.evidence)}</td>
              <td className="p-2">{asString(r.responsible)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ObjetivosCalidadView({ content }: { content: Content }) {
  const objectives = asArray<Record<string, unknown>>(content.objectives);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border border-slate-200 rounded-lg">
        <thead className="bg-slate-100 text-slate-600 text-left">
          <tr>
            <th className="p-2">Objetivo</th>
            <th className="p-2">Indicador</th>
            <th className="p-2">Meta</th>
            <th className="p-2">Plazo</th>
            <th className="p-2">Responsable</th>
            <th className="p-2">Proceso</th>
          </tr>
        </thead>
        <tbody>
          {objectives.map((o, i) => (
            <tr key={i} className="border-t border-slate-100 align-top">
              <td className="p-2 font-medium">{asString(o.objective)}</td>
              <td className="p-2">{asString(o.indicator)}</td>
              <td className="p-2">{asString(o.target)}</td>
              <td className="p-2">{asString(o.deadline)}</td>
              <td className="p-2">{asString(o.responsible)}</td>
              <td className="p-2 text-xs">{asString(o.linked_process)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {asString(content.alignment_with_policy) && (
        <p className="text-xs text-slate-500 mt-3 italic">{asString(content.alignment_with_policy)}</p>
      )}
    </div>
  );
}

export function RegistrosRequeridosView({ content }: { content: Content }) {
  const records = asArray<Record<string, unknown>>(content.records);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border border-slate-200 rounded-lg">
        <thead className="bg-slate-100 text-slate-600 text-left">
          <tr>
            <th className="p-2">Código</th>
            <th className="p-2">Registro</th>
            <th className="p-2">Cláusula</th>
            <th className="p-2">Proceso</th>
            <th className="p-2">Conservación</th>
            <th className="p-2">Responsable</th>
          </tr>
        </thead>
        <tbody>
          {records.map((r, i) => (
            <tr key={i} className="border-t border-slate-100 align-top">
              <td className="p-2 font-mono text-xs">{asString(r.code)}</td>
              <td className="p-2 font-medium">{asString(r.name)}</td>
              <td className="p-2">{asString(r.related_clause)}</td>
              <td className="p-2 text-xs">{asString(r.related_process)}</td>
              <td className="p-2 text-xs">{asString(r.retention_period)}</td>
              <td className="p-2">{asString(r.responsible)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function InformacionDocumentadaView({ content }: { content: Content }) {
  const docs = asArray<Record<string, unknown>>(content.documents);
  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full text-sm border border-slate-200 rounded-lg">
          <thead className="bg-slate-100 text-slate-600 text-left">
            <tr>
              <th className="p-2">Código</th>
              <th className="p-2">Documento</th>
              <th className="p-2">Tipo</th>
              <th className="p-2">Cláusula</th>
              <th className="p-2">Versión</th>
              <th className="p-2">Estado</th>
            </tr>
          </thead>
          <tbody>
            {docs.map((d, i) => (
              <tr key={i} className="border-t border-slate-100 align-top">
                <td className="p-2 font-mono text-xs">{asString(d.code)}</td>
                <td className="p-2 font-medium">{asString(d.title)}</td>
                <td className="p-2 capitalize">{asString(d.type)}</td>
                <td className="p-2">{asString(d.related_clause)}</td>
                <td className="p-2">{asString(d.version)}</td>
                <td className="p-2 capitalize">{asString(d.status)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {asString(content.document_control_notes) && (
        <p className="text-xs text-slate-500 italic border-t pt-3">
          {asString(content.document_control_notes)}
        </p>
      )}
    </div>
  );
}
