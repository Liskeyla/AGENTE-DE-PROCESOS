"use client";

import { FileOutput, MessageSquare, ShieldCheck } from "lucide-react";

export type WorkspaceTab = "chat" | "documents" | "diagnosis";

interface Props {
  tab: WorkspaceTab;
  onTabChange: (tab: WorkspaceTab) => void;
  messageCount?: number;
  documentsCount?: number;
}

const TABS: { key: WorkspaceTab; label: string; icon: typeof MessageSquare }[] = [
  { key: "chat", label: "Entrevista", icon: MessageSquare },
  { key: "documents", label: "Documentos SGC", icon: FileOutput },
  { key: "diagnosis", label: "Diagnóstico", icon: ShieldCheck },
];

export default function WorkspaceNav({ tab, onTabChange, messageCount = 0, documentsCount = 0 }: Props) {
  const badges: Record<WorkspaceTab, number> = {
    chat: messageCount,
    documents: documentsCount,
    diagnosis: documentsCount,
  };

  return (
    <nav className="w-14 lg:w-56 bg-surface-card border-r border-primary/10 flex flex-col shrink-0 py-3">
      {TABS.map(({ key, label, icon: Icon }) => {
        const active = tab === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onTabChange(key)}
            className={`relative flex items-center gap-3 mx-2 px-3 py-3 rounded-lg text-sm font-medium transition-all duration-200 ${
              active
                ? "bg-primary-muted text-primary shadow-card"
                : "text-ink-muted hover:bg-surface hover:text-ink"
            }`}
            title={label}
          >
            <Icon className={`w-5 h-5 shrink-0 ${active ? "text-primary" : ""}`} />
            <span className="hidden lg:inline truncate">{label}</span>
            {badges[key] > 0 && (
              <span className={`hidden lg:inline ml-auto text-[10px] px-1.5 py-0.5 rounded-full ${
                active ? "bg-secondary/15 text-secondary" : "bg-surface text-ink-faint"
              }`}>
                {badges[key]}
              </span>
            )}
            {active && (
              <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 bg-secondary rounded-r" />
            )}
          </button>
        );
      })}
    </nav>
  );
}
