import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, MapPin, Paperclip, StickyNote } from "lucide-react";
import { formatValorEdital, formatDate } from "@/lib/format";
import { faixaCorCard } from "@/lib/kanban";
import type { EditalListItem } from "@/lib/types";

const TIPO_OBJETO_LABEL: Record<"SERVICO" | "BEM" | "AMBOS", string> = {
  SERVICO: "Serviço",
  BEM: "Bem/Insumo",
  AMBOS: "Serviço + Bem",
};

function diasParaEncerrar(data: string | null): number | null {
  if (!data) return null;
  const diff = new Date(data).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export function KanbanCard({
  edital,
  foraDoPerfil,
  dragOverPos,
  onClick,
  onDragStart,
  onDragEnd,
  onDragOverCard,
  onDropCard,
  modoSelecao = false,
  selecionado = false,
}: {
  edital: EditalListItem;
  foraDoPerfil: boolean;
  dragOverPos: "before" | "after" | null;
  onClick: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onDragOverCard: (e: React.DragEvent) => void;
  onDropCard: (e: React.DragEvent) => void;
  modoSelecao?: boolean;
  selecionado?: boolean;
}) {
  const dias = diasParaEncerrar(edital.dataEncerramentoProposta);
  const prazoUrgente = dias !== null && dias <= 3;
  const [expandido, setExpandido] = useState(false);

  return (
    <div
      draggable={!modoSelecao}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOverCard}
      onDrop={onDropCard}
      onClick={onClick}
      className={`relative cursor-pointer rounded-lg border border-l-4 bg-background p-3 shadow-sm transition hover:shadow-md ${faixaCorCard(edital.corCard)} ${
        selecionado ? "border-brand ring-2 ring-brand/40" : foraDoPerfil ? "border-warning/40" : "border-border"
      }`}
    >
      {dragOverPos === "before" && (
        <div className="absolute -top-1.5 left-0 right-0 h-1 rounded-full bg-brand" />
      )}
      {dragOverPos === "after" && (
        <div className="absolute -bottom-1.5 left-0 right-0 h-1 rounded-full bg-brand" />
      )}

      {modoSelecao && (
        <input
          type="checkbox"
          checked={selecionado}
          onChange={onClick}
          onClick={(e) => e.stopPropagation()}
          className="absolute right-2 top-2 h-4 w-4 accent-brand"
        />
      )}

      {!modoSelecao && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setExpandido((v) => !v);
          }}
          title={expandido ? "Recolher" : "Expandir para ver mais detalhes"}
          className="absolute right-2 top-2 rounded p-0.5 text-muted hover:bg-surface hover:text-foreground"
        >
          {expandido ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
      )}

      <div className="flex flex-wrap items-center gap-1 pr-5">
        {edital.uf && (
          <span className="inline-flex items-center gap-0.5 rounded-full bg-brand-light px-1.5 py-0.5 text-[10px] font-medium text-brand">
            <MapPin className="h-2.5 w-2.5" /> {edital.uf}
          </span>
        )}
        {edital.fonte === "MANUAL" && (
          <span className="rounded-full bg-surface px-1.5 py-0.5 text-[10px] font-medium text-muted">Manual</span>
        )}
        {edital.tipoObjeto && (
          <span className="rounded-full bg-surface px-1.5 py-0.5 text-[10px] font-medium text-muted">
            {TIPO_OBJETO_LABEL[edital.tipoObjeto]}
          </span>
        )}
        {foraDoPerfil && (
          <span className="inline-flex items-center gap-0.5 rounded-full bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-warning">
            <AlertTriangle className="h-2.5 w-2.5" /> Fora do perfil
          </span>
        )}
      </div>

      <h4 className="mt-1.5 line-clamp-2 text-sm font-semibold leading-snug text-foreground">{edital.titulo}</h4>
      <p className="mt-1 truncate text-xs text-muted">
        {edital.orgaoNome} — {edital.municipio ?? "?"}/{edital.uf ?? "?"}
      </p>

      <div className="mt-2 flex items-center justify-between">
        <p className={`text-xs font-semibold ${edital.orcamentoSigiloso ? "italic text-muted" : "text-foreground"}`}>
          {formatValorEdital(edital.valorGlobal, edital.orcamentoSigiloso)}
        </p>
        {edital.dataEncerramentoProposta && (
          <p className={`text-[11px] ${prazoUrgente ? "font-medium text-danger" : "text-muted"}`}>
            {dias !== null && dias >= 0 ? `${dias}d` : "encerrado"} · {formatDate(edital.dataEncerramentoProposta)}
          </p>
        )}
      </div>

      {expandido && (
        <div className="mt-2 space-y-1.5 border-t border-border pt-2 text-xs">
          <p className="text-foreground/80">
            <span className="font-medium text-foreground">Objeto: </span>
            {edital.descricao}
          </p>
          <p className="text-muted">
            {edital.orgaoNome} — {edital.municipio ?? "?"}/{edital.uf ?? "?"}
          </p>
          {edital.modalidade && <p className="text-muted">Modalidade: {edital.modalidade}</p>}
          {edital.keywordMatched && <p className="text-muted">Palavra-chave: {edital.keywordMatched}</p>}
        </div>
      )}

      {((edital._count?.documents ?? 0) > 0 || edital.notasInternas) && (
        <div className="mt-2 flex items-center gap-3 border-t border-border pt-2 text-[11px] text-muted">
          {(edital._count?.documents ?? 0) > 0 && (
            <span className="inline-flex items-center gap-1">
              <Paperclip className="h-3 w-3" /> {edital._count.documents}
            </span>
          )}
          {edital.notasInternas && (
            <span className="inline-flex items-center gap-1">
              <StickyNote className="h-3 w-3" /> Nota
            </span>
          )}
        </div>
      )}
    </div>
  );
}
