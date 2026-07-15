"use client";



import { useCallback, useEffect, useState } from "react";

import { api, OrgKnowledgeState, SgqDocument } from "@/lib/api";

import { Loader2, RefreshCw } from "lucide-react";

import SgqDocumentsGrid from "@/components/SgqDocumentsGrid";



interface Props {

  projectId: string;

  refreshKey?: number;

  organizationName?: string;

}



export default function SgqDraftsPanel({ projectId, refreshKey = 0, organizationName = "Organización" }: Props) {

  const [data, setData] = useState<OrgKnowledgeState | null>(null);

  const [loading, setLoading] = useState(true);



  const load = useCallback(async () => {

    setLoading(true);

    try {

      const result = await api.getOrgKnowledgeState(projectId);

      setData(result);

    } catch {

      setData(null);

    } finally {

      setLoading(false);

    }

  }, [projectId]);



  useEffect(() => { load(); }, [load, refreshKey]);



  if (loading && !data) {

    return (

      <div className="flex items-center justify-center py-20 text-ink-muted">

        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Cargando documentos...

      </div>

    );

  }



  const documents = (data?.documents || {}) as Record<string, SgqDocument>;

  const pending = data?.pending_information || [];

  const completeness = data?.knowledge_completeness || 0;

  const knowledgeGeneral = (data?.knowledge_state as { general?: { name?: string } } | undefined)?.general;

  const orgName = knowledgeGeneral?.name?.trim() || organizationName || "Organización";



  return (

    <div className="flex-1 overflow-y-auto p-6 lg:p-8 space-y-6 enterprise-scroll bg-surface">

      <div className="flex items-center justify-between">

        <div>

          <h2 className="text-lg font-semibold text-ink">Documentos SGC</h2>

          <p className="text-sm text-ink-muted mt-1">

            Misma vista que en Diagnóstico.

          </p>

        </div>

        <button onClick={load} className="p-2 text-ink-muted hover:bg-surface rounded-lg" title="Actualizar">

          <RefreshCw className="w-4 h-4" />

        </button>

      </div>



      <div className="card !p-4">

        <div className="flex justify-between text-sm text-ink-muted mb-2">

          <span>Conocimiento organizacional</span>

          <span>{completeness}%</span>

        </div>

        <div className="h-2 bg-surface rounded-full overflow-hidden">

          <div className="h-full bg-secondary transition-all" style={{ width: `${completeness}%` }} />

        </div>

      </div>



      <SgqDocumentsGrid documents={documents} organizationName={orgName} compact />



      {pending.length > 0 && (

        <div className="bg-warning-muted border border-warning/20 rounded-xl p-4">

          <h3 className="text-sm font-medium text-warning mb-2">Información pendiente</h3>

          <ul className="text-sm text-ink space-y-1 list-disc list-inside">

            {pending.slice(0, 8).map((item) => (

              <li key={item}>{item}</li>

            ))}

          </ul>

        </div>

      )}

    </div>

  );

}

