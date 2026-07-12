"use client";

import { ChatMessage } from "@/lib/api";
import { splitParagraphs, stripMarkdown, sanitizeUserFacingText, isHiddenIntroMessage } from "@/lib/chatText";
import {
  Bot, User, Sparkles, GitBranch, FileSearch, Clock, CheckCircle2,
  MessageCircle, Shield, ClipboardList,
} from "lucide-react";

type Props = {
  message: ChatMessage;
  onOptionClick?: (option: string) => void;
  selectedOptions?: string[];
  isMultiSelect?: boolean;
};

const TYPE_LABELS: Record<string, { label: string; icon: typeof Bot; className: string }> = {
  question: { label: "Consulta ISO", icon: ClipboardList, className: "text-primary bg-primary-muted border-primary/15" },
  extraction: { label: "Análisis", icon: FileSearch, className: "text-secondary bg-secondary-muted border-secondary/20" },
  bpmn: { label: "Diagrama BPMN", icon: GitBranch, className: "text-primary bg-primary-muted border-primary/15" },
  analysis: { label: "Análisis", icon: Sparkles, className: "text-secondary bg-secondary-muted border-secondary/20" },
};

function Paragraphs({ text, className = "text-sm leading-relaxed text-ink" }: { text: string; className?: string }) {
  const parts = splitParagraphs(text);
  return (
    <div className={`space-y-2.5 ${className}`}>
      {parts.map((p, i) => (
        <p key={i}>{p}</p>
      ))}
    </div>
  );
}

function WelcomeCard({ message, onOptionClick }: Props) {
  const meta = message.metadata || {};
  const deliverables = (meta.deliverables as string[]) || [];
  const duration = meta.duration_minutes as string | undefined;
  const options = (meta.options as string[]) || [];
  const paragraphs = splitParagraphs(message.content);
  const closing = paragraphs.length > 0 ? paragraphs[paragraphs.length - 1] : "";
  const body = paragraphs.slice(0, -1);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Shield className="w-5 h-5 text-primary" />
        <span className="text-xs font-semibold uppercase tracking-wider text-primary">Bienvenida · GeoCar</span>
      </div>
      <Paragraphs text={body.join("\n\n")} />
      {deliverables.length > 0 && (
        <div className="rounded-lg bg-surface border border-primary/10 p-4">
          <p className="text-xs font-semibold text-ink-muted mb-2">Documentación que construiremos</p>
          <div className="flex flex-wrap gap-2">
            {deliverables.map((item) => (
              <span key={item} className="chip-selectable !text-[11px]">{item}</span>
            ))}
          </div>
        </div>
      )}
      {duration && (
        <div className="flex items-center gap-2 text-xs text-ink-muted">
          <Clock className="w-4 h-4" />
          <span>Duración estimada: {duration}</span>
        </div>
      )}
      {closing && <p className="text-sm font-medium text-ink">{closing}</p>}
      {options.length > 0 && onOptionClick && (
        <div className="flex flex-wrap gap-2 pt-1">
          {options.map((opt) => (
            <button key={opt} type="button" onClick={() => onOptionClick(opt)} className="btn-primary !py-2">
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function QuestionCard({ message, onOptionClick, selectedOptions = [], isMultiSelect = false }: Props) {
  const meta = message.metadata || {};
  const questionIndex = meta.question_index as number | undefined;
  const total = meta.total_questions as number | undefined;
  const hint = meta.hint as string | undefined;
  const contextPrefix = meta.context_prefix as string | undefined;
  const options = (meta.options as string[]) || [];
  const interactionType = (meta.interaction_type as string) || "";
  const isDropdown = interactionType === "dropdown";
  const clause = meta.current_clause as string | undefined;
  const questionText = sanitizeUserFacingText(message.content);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary bg-primary-muted px-2.5 py-1 rounded-md">
          <ClipboardList className="w-3.5 h-3.5" />
          {clause ? `Cláusula ${clause}` : "Consulta de levantamiento"}
        </span>
        {questionIndex != null && total != null && (
          <span className="text-xs text-ink-faint">Pregunta {questionIndex} de {total}</span>
        )}
      </div>
      {contextPrefix && <p className="text-xs text-ink-muted">{contextPrefix}</p>}
      <p className="text-[15px] font-semibold text-ink leading-snug">{questionText}</p>
      {hint && (
        <p className="text-xs text-ink-muted bg-surface rounded-lg px-3 py-2.5 border border-primary/10">
          {stripMarkdown(hint)}
        </p>
      )}
      {isDropdown && options.length > 0 && (
        <p className="text-xs text-ink-faint">Seleccione una opción en el panel inferior.</p>
      )}
      {!isDropdown && options.length > 0 && onOptionClick && (
        <div className="flex flex-wrap gap-2 pt-1">
          {options.slice(0, 12).map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => onOptionClick(opt)}
              className={selectedOptions.includes(opt) ? "chip-selected" : "chip-selectable"}
            >
              {opt}
            </button>
          ))}
          {isMultiSelect && selectedOptions.length > 0 && (
            <p className="w-full text-xs text-ink-faint">
              {selectedOptions.length} seleccionada(s). Confirme abajo.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function TypedCard({ message }: { message: ChatMessage }) {
  const typeInfo = TYPE_LABELS[message.message_type];
  const Icon = typeInfo?.icon || Bot;
  const changes = (message.metadata?.changes as string[]) || [];

  return (
    <div className="space-y-3">
      {typeInfo && (
        <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-md border ${typeInfo.className}`}>
          <Icon className="w-3.5 h-3.5" />
          {typeInfo.label}
        </span>
      )}
      <Paragraphs text={message.content} />
      {changes.length > 0 && (
        <ul className="text-xs text-ink-muted space-y-1.5">
          {changes.map((c) => (
            <li key={c} className="flex items-start gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0 mt-0.5" />
              <span>{c}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function ChatMessageBubble({
  message, onOptionClick, selectedOptions = [], isMultiSelect = false,
}: Props) {
  const isUser = message.role === "user";
  const plain = sanitizeUserFacingText(message.content);

  if (!isUser && message.message_type === "text" && !message.metadata?.is_welcome && isHiddenIntroMessage(message.content)) {
    return null;
  }

  if (isUser) {
    return (
      <div className="flex justify-end animate-slide-up">
        <div className="max-w-[85%] lg:max-w-[70%]">
          <div className="rounded-xl border border-secondary/25 bg-secondary-muted shadow-card px-5 py-4">
            <div className="flex items-center gap-2 mb-2">
              <User className="w-4 h-4 text-secondary" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted">Su respuesta</span>
            </div>
            <p className="text-sm leading-relaxed text-ink whitespace-pre-wrap">{plain}</p>
          </div>
        </div>
      </div>
    );
  }

  const isQuestion = message.message_type === "question";

  return (
    <div className="flex justify-start animate-slide-up">
      <div className="w-full max-w-[92%] lg:max-w-[78%]">
        <div className={`rounded-xl border shadow-card px-5 py-4 bg-surface-card ${
          isQuestion ? "border-secondary/30" : "border-primary/10"
        }`}>
          <div className="flex items-center gap-2 mb-3 pb-3 border-b border-primary/10">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shrink-0">
              <Bot className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="text-xs font-semibold text-ink">GeoCar</p>
              <p className="text-[10px] text-ink-faint">Consultor SGQ · ISO 9001:2015</p>
            </div>
            {isQuestion && <MessageCircle className="w-4 h-4 text-secondary ml-auto" />}
          </div>

          {message.metadata?.is_welcome ? (
            <WelcomeCard message={message} onOptionClick={onOptionClick} />
          ) : isQuestion ? (
            <QuestionCard
              message={message}
              onOptionClick={onOptionClick}
              selectedOptions={selectedOptions}
              isMultiSelect={isMultiSelect}
            />
          ) : message.message_type !== "text" ? (
            <TypedCard message={message} />
          ) : (
            <Paragraphs text={message.content} />
          )}
        </div>
      </div>
    </div>
  );
}
