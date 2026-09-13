"use client";

import { useState } from "react";
import { AlertTriangle, CheckSquare, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { empresaAtende } from "@/lib/agents/classificador-objeto";
import { ETAPAS_KANBAN } from "@/lib/kanban";
import type { EditalListItem, EtapaKanban } from "@/lib/types";
import { KanbanCard } from "@/components/dashboard/KanbanCard";
import { KanbanCardModal } from "@/components/dashboard/KanbanCardModal";

type DragOverPos = "before" | "after";

// "Em aberto" = prazo de proposta ainda não vencido (ou sem prazo informado) — independe
// da coluna do quadro, é sobre a licitação em si ainda aceitar propostas.
function estaAberta(edital: EditalListItem): boolean {
  return !edital.dataEncerramentoProposta || new Date(edital.dataEncerramentoProposta).getTime() >= Date.now();
}

function labelPortal(fonte: string): string {
  if (fonte === "PNCP") return "PNCP";
  if (fonte === "LICITANET") return "LicitaNet";
  if (fonte === "MANUAL") return "Manual";
  return fonte;
}

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

  const [modoSelecao, setModoSelecao] = useState(false);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [confirmandoExclusaoLote, setConfirmandoExclusaoLote] = useState(false);
  const [excluindoLote, setExcluindoLote] = useState(false);
  const [filtroUf, setFiltroUf] = useState<string | null>(null);
  const [filtroFonte, setFiltroFonte] = useState<string | null>(null);

  const contagemAbertasPorUf = editais.reduce<Record<string, number>>((acc, e) => {
    if (e.uf && estaAberta(e)) acc[e.uf] = (acc[e.uf] ?? 0) + 1;
    return acc;
  }, {});
  const ufsComOportunidades = Object.keys(contagemAbertasPorUf).sort();

  const contagemAbertasPorFonte = editais.reduce<Record<string, number>>((acc, e) => {
    if (estaAberta(e)) acc[e.fonte] = (acc[e.fonte] ?? 0) + 1;
    return acc;
  }, {});
  const fontesComOportunidades = Object.keys(contagemAbertasPorFonte).sort();

  function limparDrag() {
    setDraggedId(null);
    setDragOverId(null);
    setDragOverPos(null);
    setDragOverColumn(null);
  }

  function cardsDaColuna(etapa: EtapaKanban, excluirId?: string) {
    return editais
      .filter((e) => e.etapaKanban === etapa && e.id !== excluirId)
      .filter((e) => !filtroUf || e.uf === filtroUf)
      .filter((e) => !filtroFonte || e.fonte === filtroFonte)
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

  function sairDoModoSelecao() {
    setModoSelecao(false);
    setSelecionados(new Set());
    setConfirmandoExclusaoLote(false);
  }

  function alternarSelecionado(id: string) {
    setSelecionados((prev) => {
      const novo = new Set(prev);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  }

  async function handleExcluirSelecionados() {
    const ids = Array.from(selecionados);
    if (ids.length === 0) return;
    setExcluindoLote(true);
    try {
      const res = await fetch("/api/editais/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (res.ok) {
        setEditais((prev) => prev.filter((e) => !selecionados.has(e.id)));
        sairDoModoSelecao();
      }
    } finally {
      setExcluindoLote(false);
    }
  }

  return (
    <>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label htmlFor="filtroUf" className="text-xs font-medium text-muted">
              Estado
            </label>
            <select
              id="filtroUf"
              value={filtroUf ?? ""}
              onChange={(e) => setFiltroUf(e.target.value || null)}
              className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
            >
              <option value="">Todos os estados</option>
              {ufsComOportunidades.map((uf) => (
                <option key={uf} value={uf}>
                  {uf} — {contagemAbertasPorUf[uf]} em aberto
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="filtroFonte" className="text-xs font-medium text-muted">
              Portal
            </label>
            <select
              id="filtroFonte"
              value={filtroFonte ?? ""}
              onChange={(e) => setFiltroFonte(e.target.value || null)}
              className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
            >
              <option value="">Todos os portais</option>
              {fontesComOportunidades.map((fonte) => (
                <option key={fonte} value={fonte}>
                  {labelPortal(fonte)} — {contagemAbertasPorFonte[fonte]} em aberto
                </option>
              ))}
            </select>
          </div>

          {!modoSelecao ? (
            <Button variant="secondary" onClick={() => setModoSelecao(true)}>
              <CheckSquare className="h-4 w-4" /> Selecionar
            </Button>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium text-foreground">{selecionados.size} selecionado(s)</span>
              <button
                onClick={() =>
                  setSelecionados(
                    new Set(
                      editais
                        .filter((e) => !filtroUf || e.uf === filtroUf)
                        .filter((e) => !filtroFonte || e.fonte === filtroFonte)
                        .map((e) => e.id)
                    )
                  )
                }
                className="text-xs font-medium text-brand hover:underline"
              >
                Selecionar tudo
              </button>
              {selecionados.size > 0 && (
                <button onClick={() => setSelecionados(new Set())} className="text-xs font-medium text-muted hover:text-foreground">
                  Limpar seleção
                </button>
              )}
            </div>
          )}
        </div>

        {modoSelecao && (
          <div className="flex items-center gap-2">
            {!confirmandoExclusaoLote ? (
              <>
                <Button variant="secondary" onClick={sairDoModoSelecao}>
                  <X className="h-4 w-4" /> Cancelar
                </Button>
                <Button
                  variant="danger"
                  disabled={selecionados.size === 0}
                  onClick={() => setConfirmandoExclusaoLote(true)}
                >
                  <Trash2 className="h-4 w-4" /> Excluir selecionados
                </Button>
              </>
            ) : (
              <>
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-danger">
                  <AlertTriangle className="h-4 w-4" /> Excluir {selecionados.size} card(s) de vez?
                </span>
                <Button variant="secondary" onClick={() => setConfirmandoExclusaoLote(false)}>
                  Cancelar
                </Button>
                <Button variant="danger" loading={excluindoLote} onClick={handleExcluirSelecionados}>
                  Confirmar exclusão
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      <div className="mt-3 flex gap-4 overflow-x-auto pb-4">
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
                      modoSelecao={modoSelecao}
                      selecionado={selecionados.has(edital.id)}
                      onClick={() => (modoSelecao ? alternarSelecionado(edital.id) : setSelectedId(edital.id))}
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
          onDeleted={(id) => {
            setEditais((prev) => prev.filter((e) => e.id !== id));
          }}
        />
      )}
    </>
  );
}
