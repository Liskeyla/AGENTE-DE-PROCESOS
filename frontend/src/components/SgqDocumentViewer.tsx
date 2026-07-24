"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Loader2, X } from "lucide-react";
import { SgqDocument } from "@/lib/api";
import {
  downloadSgqDocumentPdf,
  getOrganizationName,
} from "@/lib/sgqDocumentExport";
import { SGQ_DOCUMENT_LABELS, SGQ_DOCUMENT_META } from "@/lib/sgqDocuments";
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
    <div className="mb-6">
      <h4 className="text-sm font-semibold text-slate-800 border-b border-slate-200 pb-1.5 mb-3">
        {title}
      </h4>
      {children}
    </div>
  );
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
    <div className="w-full overflow-x-auto">
      <table className="w-full min-w-full text-sm border border-slate-200 rounded-lg border-collapse table-auto">
        <thead className="bg-slate-100 text-slate-600 text-left">
          <tr>
            {headers.map((h) => (
              <th key={h} className="p-2.5 font-semibold align-top break-words whitespace-pre-wrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, i) => (
            <tr key={i} className="border-t border-slate-100 align-top">
              {cells.map((cell, j) => (
                <td key={j} className="p-2.5 break-words whitespace-pre-wrap text-slate-700 align-top">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DocumentHeader({
  title,
  organizationName,
  docType,
  completeness,
}: {
  title: string;
  organizationName: string;
  docType: string;
  completeness?: number | null;
}) {
  const meta = SGQ_DOCUMENT_META[docType];
  const label = SGQ_DOCUMENT_LABELS[docType] || title;

  return (
    <header className="sgq-doc-header mb-8 overflow-hidden rounded-xl border-2 border-[#1e3a5f] bg-white shadow-sm">
      <div className="bg-[#1e3a5f] px-6 py-5 text-center">
        <div className="inline-flex items-center justify-center rounded-lg bg-white px-4 py-2.5">
          <img
            src="/processum.png"
            alt="Processum S.A."
            width={200}
            height={56}
            className="h-12 sm:h-14 w-auto object-contain"
          />
        </div>
        <p className="mt-3 text-xs sm:text-sm font-semibold uppercase tracking-[0.16em] text-white/90">
          Processum S.A. · Consultorías y capacitación en SGC
        </p>
      </div>

      <div className="px-5 sm:px-8 py-6 text-center bg-white">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          Documento del Sistema de Gestión de Calidad
        </p>
        <h1 className="mt-2 text-2xl sm:text-3xl font-bold text-slate-900 leading-tight break-words">
          {label}
        </h1>
        <p className="mt-2 text-base sm:text-lg font-semibold text-[#1e3a5f] break-words">
          {organizationName}
        </p>

        {meta && (
          <div className="mt-5 mx-auto max-w-3xl rounded-xl border border-slate-200 bg-slate-50 px-5 py-4 text-left">
            <p className="text-xs font-bold uppercase tracking-wide text-[#1e3a5f] mb-2">
              Propósito del documento
            </p>
            <p className="text-sm sm:text-[15px] text-slate-700 leading-relaxed break-words">
              {meta.purpose}
            </p>
            <div className="mt-4 pt-3 border-t border-slate-200">
              <p className="text-xs font-bold uppercase tracking-wide text-[#1e3a5f] mb-1">
                Marco normativo
              </p>
              <p className="text-sm text-slate-600 leading-relaxed break-words">
                {meta.iso_ref}
              </p>
            </div>
          </div>
        )}

        {completeness != null && (
          <p className="mt-4 text-xs font-medium text-slate-500">
            Completitud del borrador: {completeness}%
          </p>
        )}
      </div>
    </header>
  );
}

function PoliticaCalidadView({ content }: { content: Content }) {
  return (
    <article>
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
        <div className="text-slate-800 leading-relaxed whitespace-pre-wrap text-sm mb-6">
          {asString(content.policy_text, "Política en elaboración.")}
        </div>
        {asArray(content.commitments).length > 0 && (
          <Section title="Compromisos">
            <ol className="list-decimal list-inside space-y-2 text-sm text-slate-700">
              {asArray(content.commitments).map((c, i) => (
                <li key={i} className="break-words">{String(c)}</li>
              ))}
            </ol>
          </Section>
        )}
        {content.alignment_with_context != null && content.alignment_with_context !== "" && (
          <p className="text-xs text-slate-500 mt-4 italic border-t pt-3 whitespace-pre-wrap break-words">
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
    <DataTable
      headers={["Proceso", "Indicador", "Objetivo", "Fórmula", "Frecuencia", "Meta", "Responsable", "Fuente"]}
      rows={indicators.map((ind) => [
        asString(ind.process_name),
        <span key="n" className="font-medium">{asString(ind.name)}</span>,
        asString(ind.objective),
        asString(ind.formula),
        asString(ind.frequency),
        asString(ind.target),
        asString(ind.responsible),
        asString(ind.data_source),
      ])}
    />
  );
}

function ProcedimientosView({ content }: { content: Content }) {
  const procedures = asArray<Record<string, unknown>>(content.procedures);
  if (!procedures.length) {
    return <p className="text-sm text-slate-500">Sin procedimientos definidos aún.</p>;
  }
  return (
    <div className="space-y-8">
      {procedures.map((proc, idx) => (
        <div key={idx} className="border border-slate-200 rounded-xl p-5 bg-white">
          <div className="flex flex-wrap items-baseline gap-3 mb-4 border-b pb-2">
            <span className="text-xs font-mono text-slate-400">
              {asString(proc.code, `PROC-${idx + 1}`)}
            </span>
            <h4 className="font-bold text-slate-800 break-words">{asString(proc.title)}</h4>
          </div>
          <div className="grid sm:grid-cols-2 gap-3 text-sm mb-4">
            <p className="break-words">
              <span className="font-medium text-slate-600">Proceso:</span> {asString(proc.process_name)}
            </p>
            <p className="break-words">
              <span className="font-medium text-slate-600">Alcance:</span> {asString(proc.scope)}
            </p>
          </div>
          <p className="text-sm text-slate-700 mb-4 whitespace-pre-wrap break-words">
            <span className="font-medium">Objetivo:</span> {asString(proc.objective)}
          </p>
          {asArray(proc.activities).length > 0 && (
            <Section title="Actividades">
              <ol className="space-y-3">
                {asArray<Record<string, unknown>>(proc.activities).map((a, i) => (
                  <li key={i} className="flex gap-3 text-sm border-l-2 border-primary/30 pl-3">
                    <span className="font-mono text-xs text-slate-400 shrink-0">
                      {asString(a.step, String(i + 1))}
                    </span>
                    <div className="min-w-0">
                      <p className="text-slate-800 whitespace-pre-wrap break-words">
                        {asString(a.description)}
                      </p>
                      <p className="text-xs text-slate-500 mt-1">
                        Responsable: {asString(a.responsible)}
                      </p>
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
    <DataTable
      headers={["Proceso origen", "Proceso destino", "Información transferida", "Dependencia"]}
      rows={rows.map((r) => [
        asString(r.source_process),
        asString(r.target_process),
        asString(r.information_transferred),
        asString(r.dependency),
      ])}
    />
  );
}

function RiesgosView({ content }: { content: Content }) {
  const entries = asArray<Record<string, unknown>>(content.entries);
  return (
    <DataTable
      headers={["Proceso", "Riesgo", "Oportunidad", "Nivel", "Acción propuesta", "Responsable"]}
      rows={entries.map((e) => [
        asString(e.related_process),
        asString(e.risk),
        asString(e.opportunity, "—"),
        asString(e.risk_level),
        asString(e.proposed_action),
        asString(e.responsible),
      ])}
    />
  );
}

interface Props {
  document: SgqDocument;
  organizationName?: string;
  /** Modal controlado desde el listado de documentos */
  open: boolean;
  onClose: () => void;
}

export default function SgqDocumentViewer({
  document: doc,
  organizationName = "Organización",
  open,
  onClose,
}: Props) {
  const content = (doc.content || {}) as Content;
  const type = doc.component_type;
  const previewExportRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);
  const orgName = getOrganizationName(doc, organizationName);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  const handleDownloadPdf = async () => {
    const target = previewExportRef.current;
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
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/55"
      role="dialog"
      aria-modal="true"
      aria-label={`Vista previa: ${doc.title}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-xl shadow-xl w-full max-w-6xl max-h-[94vh] flex flex-col overflow-hidden animate-fade-in">
        <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 border-b border-slate-200 shrink-0 bg-white">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
              Vista previa del documento
            </p>
            <h3 className="font-semibold text-slate-800 truncate text-sm sm:text-base">
              {SGQ_DOCUMENT_LABELS[type] || doc.title}
            </h3>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleDownloadPdf}
              disabled={exporting}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-primary text-white rounded-lg hover:bg-blue-700 disabled:opacity-60"
            >
              {exporting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
              Descargar PDF
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-slate-100 text-slate-500"
              aria-label="Cerrar"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4 sm:p-8 bg-slate-100">
          <div
            ref={previewExportRef}
            className="sgq-document-export bg-white rounded-lg border border-slate-200 shadow-sm p-5 sm:p-8 mx-auto max-w-5xl overflow-visible"
          >
            <DocumentHeader
              title={doc.title}
              organizationName={orgName}
              docType={type}
              completeness={doc.completeness_percent}
            />
            <div className="sgq-document-body text-slate-800 text-[15px]">
              {viewers[type] ?? (
                <p className="text-sm text-slate-500">
                  Formato de visualización no disponible para este tipo.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
