"use client";

import { RefObject } from "react";
import { Paperclip, Mic, MicOff, Send, Loader2 } from "lucide-react";

interface Props {
  input: string;
  onInputChange: (v: string) => void;
  onSend: () => void;
  loading: boolean;
  voiceSupported: boolean;
  voiceListening: boolean;
  voiceInterim: string;
  onVoiceToggle: () => void;
  onFileSelect: (files: FileList | null) => void;
  fileInputRef: RefObject<HTMLInputElement>;
  fileRequested?: boolean;
  showTextInput: boolean;
  questionOptions: string[];
  isMultiSelect: boolean;
  isDropdown: boolean;
  isDate?: boolean;
  selectedOptions: string[];
  onOptionClick: (opt: string) => void;
  onSubmitMulti: () => void;
  onDropdownChange: (value: string) => void;
  onDateSelect?: (value: string) => void;
}

export default function ChatComposer({
  input,
  onInputChange,
  onSend,
  loading,
  voiceSupported,
  voiceListening,
  voiceInterim,
  onVoiceToggle,
  onFileSelect,
  fileInputRef,
  fileRequested,
  showTextInput,
  questionOptions,
  isMultiSelect,
  isDropdown,
  isDate = false,
  selectedOptions,
  onOptionClick,
  onSubmitMulti,
  onDropdownChange,
  onDateSelect,
}: Props) {
  const displayValue = voiceListening && voiceInterim ? voiceInterim : input;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="border-t border-primary/10 bg-surface-card px-4 lg:px-6 py-4 shrink-0">
      {fileRequested && (
        <p className="text-xs text-secondary mb-3 flex items-center gap-1.5 font-medium">
          <Paperclip className="w-3.5 h-3.5" />
          Se solicita un documento de apoyo — adjúntalo con el clip
        </p>
      )}

      {isDate && onDateSelect && (
        <div className="mb-3 animate-slide-up">
          <label className="text-xs font-medium text-ink-muted mb-1.5 block">Fecha disponible</label>
          <input
            type="date"
            className="input-field max-w-xs"
            min={today}
            disabled={loading}
            onChange={(e) => {
              if (e.target.value) onDateSelect(e.target.value);
            }}
          />
        </div>
      )}

      {isDropdown && questionOptions.length > 0 && (
        <div className="mb-3 animate-slide-up">
          <label className="text-xs font-medium text-ink-muted mb-1.5 block">Seleccione una opción</label>
          <select
            className="input-field"
            defaultValue=""
            disabled={loading}
            onChange={(e) => { if (e.target.value) onDropdownChange(e.target.value); }}
          >
            <option value="" disabled>— Elija una opción —</option>
            {questionOptions.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>
      )}

      {!isDropdown && !isDate && questionOptions.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2 animate-slide-up">
          {questionOptions.slice(0, 14).map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => onOptionClick(opt)}
              disabled={loading}
              className={selectedOptions.includes(opt) ? "chip-selected" : "chip-selectable"}
            >
              {opt}
            </button>
          ))}
          {isMultiSelect && selectedOptions.length > 0 && (
            <button
              type="button"
              onClick={onSubmitMulti}
              disabled={loading}
              className="btn-primary !py-1.5 !px-4 text-xs"
            >
              Confirmar selección ({selectedOptions.length})
            </button>
          )}
        </div>
      )}

      {(showTextInput || fileRequested) && (
        <div className="flex gap-3 items-end">
          {voiceSupported && (
            <button
              type="button"
              onClick={onVoiceToggle}
              disabled={loading}
              className={`relative w-11 h-11 rounded-full flex items-center justify-center shrink-0 transition-all ${
                voiceListening
                  ? "bg-danger-muted text-danger animate-pulseSoft border-2 border-danger/30"
                  : "bg-surface border border-primary/15 text-ink-muted hover:border-secondary hover:text-secondary"
              }`}
              title={voiceListening ? "Detener grabación" : "Entrada por voz"}
            >
              {voiceListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </button>
          )}

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={loading}
            className="w-11 h-11 rounded-lg border border-primary/15 flex items-center justify-center text-ink-muted hover:bg-surface shrink-0"
          >
            <Paperclip className="w-5 h-5" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept=".pdf,.docx,.xlsx,.xls,.txt,.csv"
            onChange={(e) => onFileSelect(e.target.files)}
          />

          {showTextInput && (
            <div className="flex-1 relative">
              <textarea
                className="input-field min-h-[44px] max-h-32 resize-none pr-12"
                rows={1}
                placeholder={voiceListening ? "Escuchando… hable ahora" : "Describa con detalle cuando sea necesario…"}
                value={displayValue}
                onChange={(e) => { if (!voiceListening) onInputChange(e.target.value); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !voiceListening) {
                    e.preventDefault();
                    onSend();
                  }
                }}
                disabled={loading}
              />
              {voiceListening && (
                <span className="absolute right-3 top-3 flex gap-1">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="w-1 h-3 bg-danger rounded-full animate-pulse"
                      style={{ animationDelay: `${i * 0.15}s` }}
                    />
                  ))}
                </span>
              )}
            </div>
          )}

          {showTextInput && (
            <button
              type="button"
              onClick={onSend}
              disabled={loading || voiceListening || !input.trim()}
              className="btn-primary !px-4 h-11 flex items-center justify-center shrink-0"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          )}
        </div>
      )}

      {voiceListening && (
        <p className="text-xs text-danger mt-2 font-medium">Grabando… Revise el texto antes de enviar.</p>
      )}
    </div>
  );
}
