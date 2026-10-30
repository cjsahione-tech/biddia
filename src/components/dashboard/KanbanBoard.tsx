"use client";

import { useCallback, useState } from "react";
import { AlertTriangle, CheckSquare, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { empresaAtende } from "@/lib/agents/classificador-objeto";
import {
  ETAPAS_KANBAN,
  ETAPA_LABEL,
  classificarModalidade,
  GRUPOS_MODALIDADE,
  GRUPO_OUTRAS_MODALIDADES,
  origemPedeConfirmacaoGanho,
} from "@/lib/kanban";
import { JanelaResultadoGanho } from "@/components/resultados/JanelaResultadoGanho";
import { labelPortal } from "@/lib/fonte-edital";
import type { EditalListItem, EtapaKanban } from "@/lib/types";
import { KanbanCard } from "@/components/dashboard/KanbanCard";
import { KanbanCardModal } from "@/components/dashboard/KanbanCardModal";
import { agruparPorHabilitacao, GRUPOS_HABILITACAO, passaFiltroHabilitacao, ROTULO_STATUS_HABILITACAO } from "@/lib/habilitacao";

type DragOverPos = "before" | "after";

// "Em aberto" = prazo de proposta ainda não vencido (ou sem prazo informado) — independe
// da coluna do quadro, é sobre a licitação em si ainda aceitar propostas.
function estaAberta(edital: EditalListItem): boolean {
  return !edital.dataEncerramentoProposta || new Date(edital.dataEncerramentoProposta).getTime() >= Date.now();
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
  // Card arrastado para "Ganhas" que está esperando o valor homologado (a janela abre antes de o card mudar de coluna).
  const [ganhoPendente, setGanhoPendente] = useState<{ id: string; insertBeforeId: string | null } | null>(null);
  const fecharGanho = useCallback(() => setGanhoPendente(null), []);

  const [modoSelecao, setModoSelecao] = useState(false);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [confirmandoExclusaoLote, setConfirmandoExclusaoLote] = useState(false);
  const [excluindoLote, setExcluindoLote] = useState(false);
  const [filtroUf, setFiltroUf] = useState<string | null>(null);
  const [filtroFonte, setFiltroFonte] = useState<string | null>(null);
  const [filtroHabilitacao, setFiltroHabilitacao] = useState<string | null>(null); // um selo (ex.: "ERRO") ou um grupo ("grupo:HABILITADAS")

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

  // Ordem já vem certa do backend (data-limite mais próxima primeiro, ver GET
  // /api/editais) — só filtra aqui, sem reordenar de novo no client, pra ter uma única
  // fonte de verdade pra ordem.
  function cardsDaColuna(etapa: EtapaKanban, excluirId?: string) {
    return editais
      .filter((e) => e.etapaKanban === etapa && e.id !== excluirId)
      .filter((e) => !filtroUf || e.uf === filtroUf)
      .filter((e) => !filtroFonte || e.fonte === filtroFonte)
      .filter((e) => !filtroHabilitacao || passaFiltroHabilitacao(e.habilitacaoStatus, filtroHabilitacao));
  }

  // Coluna "Oportunidade": agrupa por modalidade na ordem fixa pedida, mantendo a ordem
  // por data (já vinda do backend) dentro de cada grupo. "Outras modalidades" sempre por
  // último, pra nenhum card sumir por não bater com nenhum grupo conhecido.
  function agruparPorModalidade(cards: EditalListItem[]) {
    const porGrupo = new Map<string, EditalListItem[]>();
    for (const edital of cards) {
      const grupo = classificarModalidade(edital.modalidade);
      if (!porGrupo.has(grupo)) porGrupo.set(grupo, []);
      porGrupo.get(grupo)!.push(edital);
    }
    return [...GRUPOS_MODALIDADE, GRUPO_OUTRAS_MODALIDADES]
      .filter((grupo) => porGrupo.has(grupo))
      .map((grupo) => ({ grupo, cards: porGrupo.get(grupo)! }));
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

  // Soltar um card em "Ganhas" (vindo de outra coluna) não move direto: abre a janela do valor homologado e da
  // planilha final. O card só muda de coluna depois de confirmar lá. Reordenar dentro de Ganhas move normalmente.
  function soltarCard(id: string, etapaDestino: EtapaKanban, insertBeforeId: string | null) {
    const edital = editais.find((e) => e.id === id);
    if (etapaDestino === "ACEITA" && edital && edital.etapaKanban !== "ACEITA") {
      setGanhoPendente({ id, insertBeforeId });
      return;
    }
    moverCard(id, etapaDestino, insertBeforeId);
  }

  async function concluirGanho() {
    const pendente = ganhoPendente;
    setGanhoPendente(null);
    if (!pendente) return;
    // O card que serviria de referência pode ter saído da coluna enquanto a janela estava aberta.
    const aindaNaColuna = pendente.insertBeforeId && cardsDaColuna("ACEITA", pendente.id).some((c) => c.id === pendente.insertBeforeId);
    await moverCard(pendente.id, "ACEITA", aindaNaColuna ? pendente.insertBeforeId : null);
  }

  const editalGanho = ganhoPendente ? (editais.find((e) => e.id === ganhoPendente.id) ?? null) : null;

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
    soltarCard(id, edital.etapaKanban, insertBeforeId);
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
    soltarCard(id, etapa, null);
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
        // Não some do quadro — vira Rascunho (soft-delete), então só atualiza a coluna
        // localmente em vez de remover os cards da lista.
        setEditais((prev) =>
          prev.map((e) =>
            selecionados.has(e.id) ? { ...e, etapaKanban: "RASCUNHO", motivoMovimentacao: "EXCLUSAO_MANUAL" } : e
          )
        );
        sairDoModoSelecao();
      }
    } finally {
      setExcluindoLote(false);
    }
  }

  function renderCard(edital: EditalListItem) {
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
  }

  return (
    <>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label htmlFor="filtroUf" className="tipo-pequeno font-bold text-ink-muted">
              Estado
            </label>
            <select
              id="filtroUf"
              value={filtroUf ?? ""}
              onChange={(e) => setFiltroUf(e.target.value || null)}
              className="min-h-11 rounded-tile border border-border bg-surface px-3 text-[13px] font-bold text-ink focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-focus-ring/30"
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
            <label htmlFor="filtroFonte" className="tipo-pequeno font-bold text-ink-muted">
              Portal
            </label>
            <select
              id="filtroFonte"
              value={filtroFonte ?? ""}
              onChange={(e) => setFiltroFonte(e.target.value || null)}
              className="min-h-11 rounded-tile border border-border bg-surface px-3 text-[13px] font-bold text-ink focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-focus-ring/30"
            >
              <option value="">Todos os portais</option>
              {fontesComOportunidades.map((fonte) => (
                <option key={fonte} value={fonte}>
                  {labelPortal(fonte)} — {contagemAbertasPorFonte[fonte]} em aberto
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="filtroHabilitacao" className="tipo-pequeno font-bold text-ink-muted">
              Habilitação
            </label>
            <select
              id="filtroHabilitacao"
              value={filtroHabilitacao ?? ""}
              onChange={(e) => setFiltroHabilitacao(e.target.value || null)}
              className="min-h-11 rounded-tile border border-border bg-surface px-3 text-[13px] font-bold text-ink focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-focus-ring/30"
            >
              <option value="">Todas</option>
              {GRUPOS_HABILITACAO.filter((g) => g.chave !== "SEM_AUDITORIA").map((g) => (
                <option key={g.chave} value={`grupo:${g.chave}`}>
                  {g.titulo} (grupo)
                </option>
              ))}
              {(["PRECISA_ACAO_HUMANA", "REVISAR_MANUALMENTE", "HABILITADA", "HABILITADA_RESSALVAS", "NAO_HABILITADA", "AGUARDANDO", "NA_FILA", "AUDITANDO", "AGUARDANDO_IA", "TEMPO_ESGOTADO", "ARQUIVO_ILEGIVEL", "EDITAL_GRANDE", "ERRO"] as const).map((st) => (
                <option key={st} value={st}>
                  {ROTULO_STATUS_HABILITACAO[st]}
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
                        .filter((e) => !filtroHabilitacao || passaFiltroHabilitacao(e.habilitacaoStatus, filtroHabilitacao))
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
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-danger-ink">
                  <AlertTriangle className="h-4 w-4" /> Mover {selecionados.size} card(s) pra Rascunho?
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

      <div className="mt-3 flex snap-x snap-proximity gap-3 overflow-x-auto pb-4 sm:gap-4">
        {ETAPAS_KANBAN.map(({ key, label }) => {
          const cards = cardsDaColuna(key);
          return (
            <div
              key={key}
              onDragOver={(e) => handleColumnDragOver(e, key)}
              onDrop={(e) => handleColumnDrop(e, key)}
              className={`flex w-[82vw] max-w-72 shrink-0 snap-start flex-col rounded-card transition sm:w-72 ${
                dragOverColumn === key ? "bg-tint ring-2 ring-brand-600/40" : "bg-neutral-bg/60"
              }`}
            >
              <div className="flex items-center justify-between px-3 py-2.5">
                <h3 className="tipo-legenda uppercase text-ink-muted">{label}</h3>
                <span className="tipo-legenda rounded-pill bg-surface px-2 py-0.5 tabular-nums text-ink-muted">
                  {cards.length}
                </span>
              </div>

              <div className="flex min-h-[60px] flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2" style={{ maxHeight: "calc(100vh - 320px)" }}>
                {key === "OPORTUNIDADE"
                  ? agruparPorModalidade(cards).map(({ grupo, cards: cardsGrupo }) => (
                      <div key={grupo} className="flex flex-col gap-2">
                        <div className="mt-1.5 flex items-center justify-between px-0.5 first:mt-0">
                          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted">{grupo}</h4>
                          <span className="text-[11px] text-muted">{cardsGrupo.length}</span>
                        </div>
                        {cardsGrupo.map((edital) => renderCard(edital))}
                      </div>
                    ))
                  : key === "QUALIFICACAO"
                    ? // Qualificação separada pelo resultado da auditoria de habilitação, com contador por grupo.
                      agruparPorHabilitacao(cards).map(({ chave, titulo, cards: cardsGrupo }) => (
                        <div key={chave} className="flex flex-col gap-2">
                          <div className="mt-1.5 flex items-center justify-between px-0.5 first:mt-0">
                            <h4
                              className={`text-[11px] font-semibold uppercase tracking-wide ${
                                chave === "HABILITADAS" ? "text-success-ink" : chave === "NAO_HABILITADAS" ? "text-danger-ink" : "text-muted"
                              }`}
                            >
                              {titulo}
                            </h4>
                            <span className="text-[11px] text-muted">{cardsGrupo.length}</span>
                          </div>
                          {cardsGrupo.map((edital) => renderCard(edital))}
                        </div>
                      ))
                    : cards.map((edital) => renderCard(edital))}
                {cards.length === 0 && (
                  <div className="rounded-tile border border-dashed border-border py-6 text-center text-[11px] text-ink-muted">
                    Arraste um card para cá
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {editalGanho && (
        <JanelaResultadoGanho
          editalId={editalGanho.id}
          tituloEdital={editalGanho.titulo}
          valorReferencia={editalGanho.valorGlobal ?? editalGanho.proposal?.valorGlobalReferencia ?? null}
          etapaAtualRotulo={origemPedeConfirmacaoGanho(editalGanho.etapaKanban) ? ETAPA_LABEL[editalGanho.etapaKanban] : null}
          modo="mover"
          onFechar={fecharGanho}
          onSalvo={concluirGanho}
        />
      )}

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
          onDeleted={async () => {
            // Não some do quadro — vira Rascunho (soft-delete), então recarrega do
            // servidor em vez de remover o card da lista local.
            await onReload();
          }}
        />
      )}
    </>
  );
}
