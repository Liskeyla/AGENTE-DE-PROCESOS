"use client";

import { useRef, useState } from "react";
import { Download, FileJson, Loader2, Maximize2, X } from "lucide-react";
import { SgqDocument } from "@/lib/api";
import {
  downloadSgqDocumentJson,
  downloadSgqDocumentPdf,
  getOrganizationName,
} from "@/lib/sgqDocumentExport";
import {
  BizagiFlowDiagram,
  BizagiOrgChart,
  BizagiProcessMap,
} from "@/components/bizagi/BizagiViews";
import {
  AlcanceSgcView,
  CaracterizacionProcesosView,
  ContextoOrganizacionView,
  CumplimientoLegalView,
  InformacionDocumentadaView,
  ObjetivosCalidadView,
  PartesInteresadasView,
  RegistrosRequeridosView,
} from "@/components/sgq/StructuredDocumentViews";

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

function PoliticaCalidadView({ content }: { content: Content }) {
  return (
    <article>
      <div className="bg-white border-2 border-slate-200 rounded-xl p-6 shadow-sm">
        <h3 className="text-center text-lg font-bold text-primary uppercase tracking-wide mb-6">
          Política de Calidad
        </h3>
        <div className="text-slate-800 leading-relaxed whitespace-pre-wrap text-sm mb-6">
          {asString(content.policy_text, "Política en elaboración.")}
        </div>
        {asArray(content.commitments).length > 0 && (
          <Section title="Compromisos">
            <ol className="list-decimal list-inside space-y-1 text-sm text-slate-700">
              {asArray(content.commitments).map((c, i) => (
                <li key={i}>{String(c)}</li>
              ))}
            </ol>
          </Section>
        )}
        {content.alignment_with_context != null && content.alignment_with_context !== "" && (
          <p className="text-xs text-slate-500 mt-4 italic border-t pt-3">
            {asString(content.alignment_with_context)}
          </p>
        )}
      </div>
    </article>
  );
}

function IndicadoresView({ content }: { content: Content }) {
  const indicators = asArray<Record<string, unknown>>(content.indicators);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border border-slate-200 rounded-lg">
        <thead className="bg-slate-100 text-slate-600 text-left">
          <tr>
            <th className="p-2">Proceso</th>
            <th className="p-2">Indicador</th>
            <th className="p-2">Objetivo</th>
            <th className="p-2">Fórmula</th>
            <th className="p-2">Frecuencia</th>
            <th className="p-2">Meta</th>
            <th className="p-2">Responsable</th>
            <th className="p-2">Fuente</th>
          </tr>
        </thead>
        <tbody>
          {indicators.map((ind, i) => (
            <tr key={i} className="border-t border-slate-100 align-top">
              <td className="p-2">{asString(ind.process_name)}</td>
              <td className="p-2 font-medium">{asString(ind.name)}</td>
              <td className="p-2 text-xs">{asString(ind.objective)}</td>
              <td className="p-2 text-xs font-mono">{asString(ind.formula)}</td>
              <td className="p-2">{asString(ind.frequency)}</td>
              <td className="p-2">{asString(ind.target)}</td>
              <td className="p-2">{asString(ind.responsible)}</td>
              <td className="p-2 text-xs">{asString(ind.data_source)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProcedimientosView({ content }: { content: Content }) {
  const procedures = asArray<Record<string, unknown>>(content.procedures);
  return (
    <div className="space-y-8">
      {procedures.map((proc, idx) => (
        <div key={idx} className="border border-slate-200 rounded-xl p-5 bg-white">
          <div className="flex items-baseline gap-3 mb-4 border-b pb-2">
            <span className="text-xs font-mono text-slate-400">{asString(proc.code, `PROC-${idx + 1}`)}</span>
            <h4 className="font-bold text-slate-800">{asString(proc.title)}</h4>
          </div>
          <div className="grid sm:grid-cols-2 gap-3 text-sm mb-4">
            <p><span className="font-medium text-slate-600">Proceso:</span> {asString(proc.process_name)}</p>
            <p><span className="font-medium text-slate-600">Alcance:</span> {asString(proc.scope)}</p>
          </div>
          <p className="text-sm text-slate-700 mb-4">
            <span className="font-medium">Objetivo:</span> {asString(proc.objective)}
          </p>
          {asArray(proc.activities).length > 0 && (
            <Section title="Actividades">
              <ol className="space-y-2">
                {asArray<Record<string, unknown>>(proc.activities).map((a, i) => (
                  <li key={i} className="flex gap-3 text-sm border-l-2 border-primary/30 pl-3">
                    <span className="font-mono text-xs text-slate-400 shrink-0">{asString(a.step, String(i + 1))}</span>
                    <div>
                      <p className="text-slate-800">{asString(a.description)}</p>
                      <p className="text-xs text-slate-500">Responsable: {asString(a.responsible)}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </Section>
          )}
        </div>
      ))}
    </div>
  );
}

function MatrizInteraccionView({ content }: { content: Content }) {
  const rows = asArray<Record<string, unknown>>(content.interactions);
  return (
    <table className="w-full text-sm border border-slate-200 rounded-lg">
      <thead className="bg-slate-100">
        <tr>
          <th className="p-2 text-left">Proceso origen</th>
          <th className="p-2 text-left">Proceso destino</th>
          <th className="p-2 text-left">Información transferida</th>
          <th className="p-2 text-left">Dependencia</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-t border-slate-100">
            <td className="p-2">{asString(r.source_process)}</td>
            <td className="p-2">{asString(r.target_process)}</td>
            <td className="p-2">{asString(r.information_transferred)}</td>
            <td className="p-2">{asString(r.dependency)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RiesgosView({ content }: { content: Content }) {
  const entries = asArray<Record<string, unknown>>(content.entries);
  return (
    <table className="w-full text-sm border border-slate-200 rounded-lg">
      <thead className="bg-slate-100">
        <tr>
          <th className="p-2">Proceso</th>
          <th className="p-2">Riesgo</th>
          <th className="p-2">Oportunidad</th>
          <th className="p-2">Nivel</th>
          <th className="p-2">Acción propuesta</th>
          <th className="p-2">Responsable</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((e, i) => (
          <tr key={i} className="border-t border-slate-100 align-top">
            <td className="p-2">{asString(e.related_process)}</td>
            <td className="p-2">{asString(e.risk)}</td>
            <td className="p-2">{asString(e.opportunity, "—")}</td>
            <td className="p-2">{asString(e.risk_level)}</td>
            <td className="p-2 text-xs">{asString(e.proposed_action)}</td>
            <td className="p-2">{asString(e.responsible)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

interface Props {
  document: SgqDocument;
  compact?: boolean;
  organizationName?: string;
  showActions?: boolean;
}

export default function SgqDocumentViewer({
  document: doc,
  compact,
  organizationName = "Organización",
  showActions = true,
}: Props) {
  const content = (doc.content || {}) as Content;
  const type = doc.component_type;
  const exportRef = useRef<HTMLDivElement>(null);
  const previewExportRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const orgName = getOrganizationName(doc, organizationName);

  const handleDownloadPdf = async () => {
    const target = previewOpen && previewExportRef.current ? previewExportRef.current : exportRef.current;
    if (!target) return;
    setExporting(true);
    try {
      await downloadSgqDocumentPdf(target, doc, { organizationName: orgName });
    } finally {
      setExporting(false);
    }
  };

  const viewers: Record<string, React.ReactNode> = {
    contexto_organizacion: <ContextoOrganizacionView content={content} />,
    alcance_sgc: <AlcanceSgcView content={content} />,
    partes_interesadas: <PartesInteresadasView content={content} />,
    mapa_procesos: <BizagiProcessMap content={content} organizationName={orgName} />,
    caracterizacion_procesos: <CaracterizacionProcesosView content={content} />,
    diagrama_flujo: <BizagiFlowDiagram content={content} organizationName={orgName} />,
    organigrama: <BizagiOrgChart content={content} organizationName={orgName} />,
    politica_calidad: <PoliticaCalidadView content={content} />,
    objetivos_calidad: <ObjetivosCalidadView content={content} />,
    indicadores: <IndicadoresView content={content} />,
    procedimientos: <ProcedimientosView content={content} />,
    matriz_interaccion: <MatrizInteraccionView content={content} />,
    cumplimiento_legal: <CumplimientoLegalView content={content} />,
    riesgos_oportunidades: <RiesgosView content={content} />,
    registros_requeridos: <RegistrosRequeridosView content={content} />,
    informacion_documentada: <InformacionDocumentadaView content={content} />,
  };

  const documentContent = (
    <>
      <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-200">
        <div>
          <h3 className="font-semibold text-slate-800">{doc.title}</h3>
          <p className="text-xs text-slate-500 mt-0.5">{orgName}</p>
        </div>
        {doc.completeness_percent != null && (
          <span className="text-xs text-slate-500">{doc.completeness_percent}% completo</span>
        )}
      </div>
      {viewers[type] ?? (
        <p className="text-sm text-slate-500">Formato de visualización no disponible para este tipo.</p>
      )}
    </>
  );

  return (
    <>
      {showActions && (
        <div className="flex flex-wrap gap-2 mb-3">
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-700"
          >
            <Maximize2 className="w-3.5 h-3.5" />
            Vista previa
          </button>
          <button
            type="button"
            onClick={handleDownloadPdf}
            disabled={exporting}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary text-white rounded-lg hover:bg-blue-700 disabled:opacity-60"
          >
            {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            Descargar PDF
          </button>
          <button
            type="button"
            onClick={() => downloadSgqDocumentJson(doc, orgName)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-700"
          >
            <FileJson className="w-3.5 h-3.5" />
            Descargar JSON
          </button>
        </div>
      )}

      <div ref={exportRef} className={`sgq-document-export bg-white ${compact ? "text-sm" : ""}`}>
        {documentContent}
      </div>

      {previewOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-6xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 shrink-0">
              <div>
                <h3 className="font-semibold text-slate-800">{doc.title}</h3>
                <p className="text-xs text-slate-500">{orgName}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleDownloadPdf}
                  disabled={exporting}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary text-white rounded-lg hover:bg-blue-700 disabled:opacity-60"
                >
                  {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                  PDF
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewOpen(false)}
                  className="p-2 rounded-lg hover:bg-slate-100 text-slate-500"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-5">
              <div ref={previewExportRef} className="sgq-document-export bg-white">
                {documentContent}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
