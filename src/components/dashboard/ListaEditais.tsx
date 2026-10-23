"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { MapPin, Search, X } from "lucide-react";
import { Abas } from "@/components/ui/Abas";
import { Button } from "@/components/ui/Button";
import { Cartao } from "@/components/ui/Cartao";
import { Chip, type TomChip } from "@/components/ui/Chip";
import { Janela } from "@/components/ui/Janela";
import { SeloHabilitacao } from "@/components/editais/SeloHabilitacao";
import { etapaAudita } from "@/lib/habilitacao";
import { descreverValorEdital } from "@/lib/format";
import { labelPortal } from "@/lib/fonte-edital";
import { ETAPAS_KANBAN } from "@/lib/kanban";
import { rotuloPrazo, type TomPrazo } from "@/lib/painel-util";
import type { EditalListItem, EtapaKanban } from "@/lib/types";

const TOM_DO_PRAZO: Record<TomPrazo, TomChip> = { urgente: "atencao", normal: "info", encerrado: "neutro", semData: "neutro" };
const TIPO_OBJETO: Record<string, string> = { SERVICO: "Serviço", BEM: "Bem/Insumo", AMBOS: "Serviço + Bem" };

/**
 * Cartão de edital (igual em qualquer tela), de cima para baixo: chips (UF, modalidade, selo de habilitação); título em
 * até 2 linhas; órgão em caixa alta; valor e prazo separados por um divisor; ação em brand-600.
 */
export function CartaoEdital({ edital, onQualificar }: { edital: EditalListItem; onQualificar?: (e: EditalListItem) => void }) {
  const prazo = rotuloPrazo(edital.dataEncerramentoProposta);
  const valor = descreverValorEdital(edital);
  const podeQualificar = edital.etapaKanban === "OPORTUNIDADE" && !!onQualificar;
  const mostrarSelo = etapaAudita(edital.etapaKanban) || edital.habilitacaoStatus === "HABILITADA" || edital.habilitacaoStatus === "NAO_HABILITADA";
  return (
    <Cartao className="flex h-full flex-col">
      <Link href={`/editais/${edital.id}`} className="block flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {!edital.visualizado && <Chip tom="marca">Novo</Chip>}
          {edital.uf && (
            <Chip icone={MapPin}>{edital.uf}</Chip>
          )}
          {edital.modalidade && <Chip tom="neutro">{edital.modalidade}</Chip>}
          {edital.tipoObjeto && <Chip tom="neutro">{TIPO_OBJETO[edital.tipoObjeto]}</Chip>}
          {mostrarSelo && <SeloHabilitacao status={edital.habilitacaoStatus} percentual={edital.habilitacaoPercentual} etapa={edital.etapaKanban} />}
        </div>
        <p className="tipo-titulo-3 mt-2.5 line-clamp-2 text-ink">{edital.titulo}</p>
        <p className="tipo-pequeno mt-1 truncate uppercase text-ink-muted">
          {edital.orgaoNome} · {labelPortal(edital.fonte)}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-3">
          <span className={`tipo-corpo-forte tabular-nums ${valor.apagado ? "italic text-ink-muted" : "text-ink"}`}>{valor.texto}</span>
          <Chip tom={TOM_DO_PRAZO[prazo.tom]} className="tabular-nums">
            {prazo.texto}
          </Chip>
        </div>
      </Link>
      <div className="mt-2 flex items-center">
        {podeQualificar ? (
          <Button variant="ghost" size="compacto" className="-ml-4" onClick={() => onQualificar!(edital)}>
            Qualificar →
          </Button>
        ) : (
          <Link href={`/editais/${edital.id}`} className="tipo-corpo-forte inline-flex min-h-[34px] items-center text-brand-600">
            Abrir →
          </Link>
        )}
      </div>
    </Cartao>
  );
}

/**
 * Lista de editais (todas as telas): pílulas de etapa com contagem e cartões em 1, 2 ou 3 colunas. "Qualificar →" faz o MESMO
 * que arrastar o card para Qualificação no quadro: dispara os agentes e a auditoria de habilitação (usa IA) — por isso pede
 * confirmação antes.
 */
export function ListaEditais({
  editais,
  onMovido,
  comBusca = false,
  etapaInicial,
  limite,
}: {
  editais: EditalListItem[];
  onMovido: () => void | Promise<void>;
  comBusca?: boolean;
  etapaInicial?: EtapaKanban | "TODOS";
  /** Mostra só os primeiros N cartões (na tela Início); sem isso mostra todos. */
  limite?: number;
}) {
  const contagem = useMemo(() => {
    const m = new Map<EtapaKanban, number>();
    for (const e of editais) m.set(e.etapaKanban, (m.get(e.etapaKanban) ?? 0) + 1);
    return m;
  }, [editais]);

  const etapasVisiveis = ETAPAS_KANBAN.filter((e) => (contagem.get(e.key) ?? 0) > 0 || e.key === "OPORTUNIDADE" || e.key === "QUALIFICACAO");
  const padrao: EtapaKanban | "TODOS" = comBusca
    ? "TODOS"
    : (contagem.get("OPORTUNIDADE") ?? 0) > 0
      ? "OPORTUNIDADE"
      : (etapasVisiveis.find((e) => (contagem.get(e.key) ?? 0) > 0)?.key ?? "OPORTUNIDADE");
  const [escolhida, setEscolhida] = useState<EtapaKanban | "TODOS" | null>(etapaInicial ?? null);
  const etapa = escolhida ?? padrao;
  const [busca, setBusca] = useState("");
  const [paraQualificar, setParaQualificar] = useState<EditalListItem | null>(null);
  const [movendo, setMovendo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const q = busca.trim().toLowerCase();
  const filtrada = editais.filter(
    (e) =>
      (etapa === "TODOS" ? e.etapaKanban !== "RASCUNHO" : e.etapaKanban === etapa) &&
      (!q || `${e.titulo} ${e.orgaoNome} ${e.municipio ?? ""}`.toLowerCase().includes(q))
  );
  const lista = limite ? filtrada.slice(0, limite) : filtrada;
  const totalDaEtapa = etapa === "TODOS" ? editais.filter((e) => e.etapaKanban !== "RASCUNHO").length : (contagem.get(etapa) ?? 0);

  async function confirmarQualificar() {
    if (!paraQualificar) return;
    setMovendo(true);
    setErro(null);
    try {
      const res = await fetch(`/api/editais/${paraQualificar.id}/kanban`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ etapaKanban: "QUALIFICACAO", ordemKanban: Date.now() }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        setErro(d?.error ?? "Não foi possível mover o edital.");
        return;
      }
      setParaQualificar(null);
      await onMovido();
    } finally {
      setMovendo(false);
    }
  }

  const itensAbas = [
    ...(comBusca ? [{ chave: "TODOS", rotulo: "Todos", contagem: editais.filter((e) => e.etapaKanban !== "RASCUNHO").length }] : []),
    ...etapasVisiveis.map((e) => ({ chave: e.key as string, rotulo: e.label, contagem: contagem.get(e.key) ?? 0 })),
  ];

  return (
    <div>
      {comBusca && (
        <label className="flex min-h-11 items-center gap-2 rounded-pill bg-surface px-4 text-[15px] text-ink-muted shadow-card">
          <Search className="h-4 w-4 shrink-0" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por objeto, órgão ou cidade"
            className="min-w-0 flex-1 bg-transparent text-[15px] text-ink placeholder:text-ink-muted/70 focus:outline-none"
          />
          {busca && (
            <button onClick={() => setBusca("")} aria-label="Limpar busca" className="flex h-11 w-11 items-center justify-center">
              <X className="h-4 w-4" />
            </button>
          )}
        </label>
      )}

      <Abas variante="etapas" itens={itensAbas} ativa={etapa} onChange={(c) => setEscolhida(c as EtapaKanban | "TODOS")} rotuloAcessivel="Etapas" className={comBusca ? "mt-3" : ""} />

      <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {lista.map((e) => (
          <CartaoEdital key={e.id} edital={e} onQualificar={setParaQualificar} />
        ))}
      </div>
      {lista.length === 0 && (
        <p className="rounded-card bg-surface p-5 text-center text-sm text-ink-muted shadow-card">
          {busca ? "Nenhum edital encontrado para essa busca." : "Nenhum edital nesta etapa."}
        </p>
      )}
      {limite && totalDaEtapa > lista.length && (
        <div className="mt-3 text-center">
          <Link href={etapa === "TODOS" ? "/editais" : `/editais?etapa=${etapa}`} className="tipo-corpo-forte inline-flex min-h-11 items-center text-brand-600">
            Ver todos os {totalDaEtapa} →
          </Link>
        </div>
      )}

      <Janela
        aberta={!!paraQualificar}
        onFechar={() => setParaQualificar(null)}
        titulo="Mover para Qualificação?"
        descricao="Os agentes vão analisar o edital e a auditoria de habilitação começa em seguida — isso usa IA. É o mesmo que arrastar o card para “Qualificação” no quadro."
        rodape={
          <>
            <Button variant="secondary" onClick={() => setParaQualificar(null)} disabled={movendo}>
              Cancelar
            </Button>
            <Button onClick={confirmarQualificar} loading={movendo}>
              Qualificar
            </Button>
          </>
        }
      >
        <p className="tipo-corpo-forte text-ink">{paraQualificar?.titulo}</p>
        {erro && <p className="mt-2 text-sm text-danger-ink">{erro}</p>}
      </Janela>
    </div>
  );
}
