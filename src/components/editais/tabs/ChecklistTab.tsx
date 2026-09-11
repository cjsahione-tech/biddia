"use client";

import { useRef, useState } from "react";
import { CheckCircle2, AlertTriangle, Clock, XCircle, Paperclip, Download, X, Loader2 } from "lucide-react";
import { AgentChat } from "@/components/editais/AgentChat";
import type { ChecklistItem } from "@/lib/types";

const TAMANHO_MAXIMO_ANEXO = 3.5 * 1024 * 1024;

const STATUS_CONFIG: Record<
  ChecklistItem["status"],
  { label: string; icon: typeof CheckCircle2; className: string }
> = {
  OK: { label: "OK", icon: CheckCircle2, className: "text-accent bg-accent/10" },
  ENVIADO: { label: "Enviado", icon: Clock, className: "text-brand bg-brand-light" },
  VENCIDO: { label: "Vencido", icon: XCircle, className: "text-danger bg-danger/10" },
  FALTANTE: { label: "Faltante", icon: AlertTriangle, className: "text-warning bg-warning/10" },
};

type PatchChecklistItem = Partial<{
  status: ChecklistItem["status"];
  validade: string | null;
  anexoNome: string;
  anexoBase64: string;
  removerAnexo: boolean;
}>;

function ChecklistRow({
  editalId,
  item,
  onUpdate,
}: {
  editalId: string;
  item: ChecklistItem;
  onUpdate: () => void;
}) {
  const cfg = STATUS_CONFIG[item.status];
  const [temValidade, setTemValidade] = useState(!!item.validade);
  const [uploading, setUploading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function updateItem(patch: PatchChecklistItem) {
    const res = await fetch(`/api/editais/${editalId}/checklist/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    onUpdate();
    return res;
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setErro(null);
    if (file.size > TAMANHO_MAXIMO_ANEXO) {
      setErro(`Arquivo muito grande (máx. ${(TAMANHO_MAXIMO_ANEXO / 1024 / 1024).toFixed(1)}MB).`);
      return;
    }
    setUploading(true);
    try {
      const anexoBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const res = await updateItem({ anexoNome: file.name, anexoBase64 });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setErro(data?.error ?? "Não foi possível enviar o anexo.");
      }
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="border-b border-border py-3 last:border-0">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{item.documentoNome}</p>
          {item.observacao && <p className="text-xs text-muted">{item.observacao}</p>}
        </div>
        <span
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${cfg.className}`}
        >
          <cfg.icon className="h-3.5 w-3.5" />
          {cfg.label}
        </span>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-1.5 text-xs text-muted">
          <input
            type="checkbox"
            checked={temValidade}
            onChange={(e) => {
              const checked = e.target.checked;
              setTemValidade(checked);
              if (!checked) updateItem({ validade: null });
            }}
            className="accent-brand"
          />
          Tem validade
        </label>
        {temValidade && (
          <input
            type="date"
            value={item.validade ? item.validade.slice(0, 10) : ""}
            onChange={(e) => updateItem({ validade: e.target.value || null })}
            className="rounded-lg border border-border bg-background px-2 py-1 text-xs text-foreground focus:border-brand focus:outline-none"
          />
        )}
        <select
          value={item.status}
          onChange={(e) => updateItem({ status: e.target.value as ChecklistItem["status"] })}
          className="rounded-lg border border-border bg-background px-2 py-1 text-xs text-foreground focus:border-brand focus:outline-none"
        >
          <option value="FALTANTE">Faltante</option>
          <option value="ENVIADO">Enviado</option>
          <option value="OK">OK</option>
          <option value="VENCIDO">Vencido</option>
        </select>

        <div className="ml-auto flex items-center gap-2">
          {item.anexoDocId ? (
            <>
              <a
                href={`/api/editais/${editalId}/documents/${item.anexoDocId}/download`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-w-0 items-center gap-1 text-xs text-brand hover:underline"
              >
                <Download className="h-3 w-3 shrink-0" />
                <span className="max-w-[160px] truncate">{item.anexoNome}</span>
              </a>
              <button
                onClick={() => updateItem({ removerAnexo: true })}
                className="shrink-0 text-muted hover:text-danger"
                title="Remover anexo"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </>
          ) : (
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-surface disabled:opacity-60"
            >
              {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Paperclip className="h-3 w-3" />}
              Anexar
            </button>
          )}
          <input ref={fileInputRef} type="file" className="hidden" onChange={handleFile} />
        </div>
      </div>
      {erro && <p className="mt-1 text-xs text-danger">{erro}</p>}
    </div>
  );
}

export function ChecklistTab({
  editalId,
  items,
  onUpdate,
}: {
  editalId: string;
  items: ChecklistItem[];
  onUpdate: () => void;
}) {
  if (items.length === 0) {
    return (
      <div className="space-y-6">
        <p className="py-12 text-center text-sm text-muted">
          O Agente Secretário ainda não montou o checklist deste edital.
        </p>
        <AgentChat editalId={editalId} agentKey="agente5-secretario" agentLabel="Agente Secretário" onCorrected={onUpdate} />
      </div>
    );
  }

  const obrigatorios = items.filter((i) => i.obrigatorio);
  const opcionais = items.filter((i) => !i.obrigatorio);

  return (
    <div className="space-y-8">
      <div>
        <h4 className="text-sm font-semibold text-foreground">Documentos obrigatórios</h4>
        <div className="mt-2 rounded-2xl border border-border px-4">
          {obrigatorios.map((item) => (
            <ChecklistRow key={item.id} editalId={editalId} item={item} onUpdate={onUpdate} />
          ))}
        </div>
      </div>
      {opcionais.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-foreground">Documentos adicionais</h4>
          <div className="mt-2 rounded-2xl border border-border px-4">
            {opcionais.map((item) => (
              <ChecklistRow key={item.id} editalId={editalId} item={item} onUpdate={onUpdate} />
            ))}
          </div>
        </div>
      )}

      <AgentChat editalId={editalId} agentKey="agente5-secretario" agentLabel="Agente Secretário" onCorrected={onUpdate} />
    </div>
  );
}
