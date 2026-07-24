"use client";

import { useState } from "react";
import { SgqDocument } from "@/lib/api";
import {
  SGQ_DOCUMENT_LABELS,
  SGQ_DOCUMENT_TYPES,
  DocumentJustification,
  documentIsViewable,
  documentStatusLabel,
} from "@/lib/sgqDocuments";
import { FileText } from "lucide-react";
import SgqDocumentViewer from "@/components/SgqDocumentViewer";

interface Props {
  documents: Record<string, SgqDocument>;
  organizationName: string;
  justifications?: Record<string, DocumentJustification>;
  compact?: boolean;
}

export default function SgqDocumentsGrid({
  documents,
  organizationName,
  justifications = {},
  compact = false,
}: Props) {
  const [expandedDoc, setExpandedDoc] = useState<string | null>(null);

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {SGQ_DOCUMENT_TYPES.map((key) => {
        const doc = documents[key];
        const label = SGQ_DOCUMENT_LABELS[key] || key;
        const meta = justifications[key];
        const viewable = documentIsViewable(doc);
        const pct = doc?.completeness_percent ?? 0;
        const isExpanded = expandedDoc === key;

        return (
          <div
            key={key}
            className={`bg-surface-card border border-primary/10 rounded-xl p-4 shadow-card ${
              isExpanded ? "sm:col-span-2" : ""
            }`}
          >
            <div className="flex items-start gap-3">
              <FileText className="w-5 h-5 text-primary shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-ink text-sm">{label}</p>
                <p className="text-xs text-ink-muted mt-0.5 capitalize">
                  {documentStatusLabel(doc)}
                </p>
                {doc && (
                  <div className="h-1.5 bg-surface rounded-full mt-2 overflow-hidden">
                    <div
                      className="h-full bg-secondary rounded-full transition-all duration-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                )}
                {meta?.related_requirements && meta.related_requirements.length > 0 && (
                  <p className="text-[10px] text-ink-faint mt-2">
                    ISO: {meta.related_requirements.join(", ")}
                  </p>
                )}
                {meta?.justification && (
                  <p className="text-[10px] text-ink-muted mt-1 line-clamp-2 italic">
                    {meta.justification}
                  </p>
                )}
                {viewable && doc && (
                  <button
                    type="button"
                    onClick={() => setExpandedDoc(isExpanded ? null : key)}
                    className="text-xs text-secondary mt-2 hover:underline font-medium"
                  >
                    {isExpanded ? "Ocultar" : "Ver documento"}
                  </button>
                )}
              </div>
            </div>
            {isExpanded && doc && (
              <div className="mt-4 bg-white border border-primary/10 rounded-lg p-4 sm:p-5">
                <SgqDocumentViewer
                  document={doc}
                  compact={compact}
                  organizationName={organizationName}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
