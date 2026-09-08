import { CheckCircle2, AlertTriangle, Clock, XCircle } from "lucide-react";
import type { ChecklistItem } from "@/lib/types";

const STATUS_CONFIG: Record<
  ChecklistItem["status"],
  { label: string; icon: typeof CheckCircle2; className: string }
> = {
  OK: { label: "OK", icon: CheckCircle2, className: "text-accent bg-accent/10" },
  ENVIADO: { label: "Enviado", icon: Clock, className: "text-brand bg-brand-light" },
  VENCIDO: { label: "Vencido", icon: XCircle, className: "text-danger bg-danger/10" },
  FALTANTE: { label: "Faltante", icon: AlertTriangle, className: "text-warning bg-warning/10" },
};

export function ChecklistTab({
  editalId,
  items,
  onUpdate,
}: {
  editalId: string;
  items: ChecklistItem[];
  onUpdate: () => void;
}) {
  async function updateItem(itemId: string, patch: Partial<Pick<ChecklistItem, "status" | "validade">>) {
    await fetch(`/api/editais/${editalId}/checklist/${itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    onUpdate();
  }

  if (items.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-muted">
        O Agente Secretário ainda não montou o checklist deste edital.
      </p>
    );
  }

  const obrigatorios = items.filter((i) => i.obrigatorio);
  const opcionais = items.filter((i) => !i.obrigatorio);

  const renderRow = (item: ChecklistItem) => {
    const cfg = STATUS_CONFIG[item.status];
    return (
      <div key={item.id} className="flex items-center justify-between gap-4 border-b border-border py-3 last:border-0">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{item.documentoNome}</p>
          {item.observacao && <p className="text-xs text-muted">{item.observacao}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${cfg.className}`}
          >
            <cfg.icon className="h-3.5 w-3.5" />
            {cfg.label}
          </span>
          <input
            type="date"
            value={item.validade ? item.validade.slice(0, 10) : ""}
            onChange={(e) => updateItem(item.id, { validade: e.target.value || null })}
            className="rounded-lg border border-border bg-background px-2 py-1 text-xs text-foreground focus:border-brand focus:outline-none"
          />
          <select
            value={item.status}
            onChange={(e) => updateItem(item.id, { status: e.target.value as ChecklistItem["status"] })}
            className="rounded-lg border border-border bg-background px-2 py-1 text-xs text-foreground focus:border-brand focus:outline-none"
          >
            <option value="FALTANTE">Faltante</option>
            <option value="ENVIADO">Enviado</option>
            <option value="OK">OK</option>
            <option value="VENCIDO">Vencido</option>
          </select>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-8">
      <div>
        <h4 className="text-sm font-semibold text-foreground">Documentos obrigatórios</h4>
        <div className="mt-2 rounded-2xl border border-border px-4">{obrigatorios.map(renderRow)}</div>
      </div>
      {opcionais.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-foreground">Documentos adicionais</h4>
          <div className="mt-2 rounded-2xl border border-border px-4">{opcionais.map(renderRow)}</div>
        </div>
      )}
    </div>
  );
}
