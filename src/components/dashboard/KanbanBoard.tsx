"use client";

import { useState } from "react";
import { empresaAtende } from "@/lib/agents/classificador-objeto";
import { ETAPAS_KANBAN } from "@/lib/kanban";
import type { EditalListItem, EtapaKanban } from "@/lib/types";
import { KanbanCard } from "@/components/dashboard/KanbanCard";
import { KanbanCardModal } from "@/components/dashboard/KanbanCardModal";

type DragOverPos = "before" | "after";

export function KanbanBoard({
  editais,
  setEditais,
  perfil,
  onReload,
}: {
  editais: EditalListItem[];
  setEditais: React.Dispatch<React.SetStateAction<EditalListItem[]>>;
  perfil: { atendeServico: boolean; atendeBem: boolean };
  onReload: () => Promise<void>;
}) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dragOverPos, setDragOverPos] = useState<DragOverPos | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<EtapaKanban | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  function limparDrag() {
    setDraggedId(null);
    setDragOverId(null);
    setDragOverPos(null);
    setDragOverColumn(null);
  }

  function cardsDaColuna(etapa: EtapaKanban, excluirId?: string) {
    return editais
      .filter((e) => e.etapaKanban === etapa && e.id !== excluirId)
      .sort((a, b) => a.ordemKanban - b.ordemKanban);
  }

  async function moverCard(id: string, etapaDestino: EtapaKanban, insertBeforeId: string | null) {
    const colunaDestino = cardsDaColuna(etapaDestino, id);
    let novaOrdem: number;
    if (insertBeforeId === null) {
      const ultimo = colunaDestino[colunaDestino.length - 1];
      novaOrdem = ultimo ? ultimo.ordemKanban + 1000 : 1000;
    } else {
      const idx = colunaDestino.findIndex((c) => c.id === insertBeforeId);
      const alvo = colunaDestino[idx];
      const anterior = colunaDestino[idx - 1];
      novaOrdem = anterior ? (anterior.ordemKanban + alvo.ordemKanban) / 2 : alvo.ordemKanban - 1000;
    }

    setEditais((prev) =>
      prev.map((e) => (e.id === id ? { ...e, etapaKanban: etapaDestino, ordemKanban: novaOrdem } : e))
    );

    try {
      const res = await fetch(`/api/editais/${id}/kanban`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ etapaKanban: etapaDestino, ordemKanban: novaOrdem }),
      });
      if (!res.ok) {
        await onReload();
        return;
      }
      const data = await res.json();
      // O status pode ter mudado junto (1ª decisão sobre o edital) — sincroniza pra não
      // desalinhar telas que ainda olham pro status legado.
      setEditais((prev) => prev.map((e) => (e.id === id ? { ...e, status: data.edital.status } : e)));
    } catch {
      await onReload();
    }
  }

  function handleDragStart(id: string) {
    setDraggedId(id);
  }

  function handleDragOverCard(e: React.DragEvent, edital: EditalListItem) {
    e.preventDefault();
    e.stopPropagation();
    if (draggedId === edital.id) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pos: DragOverPos = e.clientY < rect.top + rect.height / 2 ? "before" : "after";
    setDragOverId(edital.id);
    setDragOverPos(pos);
    setDragOverColumn(edital.etapaKanban);
  }

  function handleDropOnCard(e: React.DragEvent, edital: EditalListItem) {
    e.preventDefault();
    e.stopPropagation();
    if (!draggedId || draggedId === edital.id) {
      limparDrag();
      return;
    }
    const coluna = cardsDaColuna(edital.etapaKanban, draggedId);
    const idx = coluna.findIndex((c) => c.id === edital.id);
    const insertBeforeId = dragOverPos === "after" ? (coluna[idx + 1]?.id ?? null) : edital.id;
    const id = draggedId;
    limparDrag();
    moverCard(id, edital.etapaKanban, insertBeforeId);
  }

  function handleColumnDragOver(e: React.DragEvent, etapa: EtapaKanban) {
    e.preventDefault();
    setDragOverColumn(etapa);
    setDragOverId(null);
  }

  function handleColumnDrop(e: React.DragEvent, etapa: EtapaKanban) {
    e.preventDefault();
    if (!draggedId) return;
    const id = draggedId;
    limparDrag();
    moverCard(id, etapa, null);
  }

  return (
    <>
      <div className="mt-6 flex gap-4 overflow-x-auto pb-4">
        {ETAPAS_KANBAN.map(({ key, label }) => {
          const cards = cardsDaColuna(key);
          return (
            <div
              key={key}
              onDragOver={(e) => handleColumnDragOver(e, key)}
              onDrop={(e) => handleColumnDrop(e, key)}
              className={`flex w-72 shrink-0 flex-col rounded-xl border bg-surface/50 transition ${
                dragOverColumn === key ? "border-brand/50 bg-brand-light/30" : "border-border"
              }`}
            >
              <div className="flex items-center justify-between px-3 py-2.5">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</h3>
                <span className="rounded-full bg-surface px-1.5 py-0.5 text-[11px] font-medium text-muted">
                  {cards.length}
                </span>
              </div>

              <div className="flex min-h-[60px] flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2" style={{ maxHeight: "calc(100vh - 320px)" }}>
                {cards.map((edital) => {
                  const foraDoPerfil = edital.tipoObjeto ? !empresaAtende(edital.tipoObjeto, perfil) : false;
                  return (
                    <KanbanCard
                      key={edital.id}
                      edital={edital}
                      foraDoPerfil={foraDoPerfil}
                      dragOverPos={dragOverId === edital.id ? dragOverPos : null}
                      onClick={() => setSelectedId(edital.id)}
                      onDragStart={() => handleDragStart(edital.id)}
                      onDragEnd={limparDrag}
                      onDragOverCard={(e) => handleDragOverCard(e, edital)}
                      onDropCard={(e) => handleDropOnCard(e, edital)}
                    />
                  );
                })}
                {cards.length === 0 && (
                  <div className="rounded-lg border border-dashed border-border py-6 text-center text-[11px] text-muted">
                    Arraste um card para cá
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {selectedId && (
        <KanbanCardModal
          editalId={selectedId}
          onClose={() => setSelectedId(null)}
          onUpdated={(partial) => {
            setEditais((prev) => prev.map((e) => (e.id === selectedId ? { ...e, ...partial } : e)));
          }}
          onMoved={async () => {
            await onReload();
          }}
        />
      )}
    </>
  );
}
