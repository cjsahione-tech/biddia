"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, Search, X } from "lucide-react";
import { etapaAudita } from "@/lib/habilitacao";
import { descreverValorEdital } from "@/lib/format";
import { labelPortal } from "@/lib/fonte-edital";
import { ETAPAS_KANBAN } from "@/lib/kanban";
import { rotuloPrazo, type TomPrazo } from "@/lib/mobile-util";
import type { EditalListItem, EtapaKanban } from "@/lib/types";
import { SeloHabilitacao } from "@/components/editais/SeloHabilitacao";

const ESTILO_PRAZO: Record<TomPrazo, string> = {
  urgente: "bg-[#fef3c7] text-[#92400e]",
  normal: "bg-brand-light text-[#312e81]",
  encerrado: "bg-[#e8e9f3] text-muted",
  semData: "bg-[#e8e9f3] text-muted",
};

const TIPO_OBJETO: Record<string, string> = { SERVICO: "Serviço", BEM: "Bem/Insumo", AMBOS: "Serviço + Bem" };

/** Cartão branco de um edital: título, órgão e portal, prazo, valor e a ação principal. */
export function CartaoEditalMobile({ edital, onQualificar }: { edital: EditalListItem; onQualificar?: (e: EditalListItem) => void }) {
  const prazo = rotuloPrazo(edital.dataEncerramentoProposta);
  const valor = descreverValorEdital(edital);
  const podeQualificar = edital.etapaKanban === "OPORTUNIDADE" && !!onQualificar;
  return (
    <div className="rounded-[20px] bg-white p-3.5">
      <Link href={`/editais/${edital.id}`} className="block">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="line-clamp-2 text-[14px] font-bold leading-snug text-foreground">{edital.titulo}</p>
            <p className="mt-0.5 truncate text-[11.5px] text-muted">
              {edital.orgaoNome} · {labelPortal(edital.fonte)}
            </p>
          </div>
          <span className={`flex-none rounded-[10px] px-2.5 py-1 text-[10.5px] font-bold ${ESTILO_PRAZO[prazo.tom]}`}>{prazo.texto}</span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-muted">
          {edital.modalidade && <span>{edital.modalidade}</span>}
          {edital.tipoObjeto && <span>· {TIPO_OBJETO[edital.tipoObjeto]}</span>}
          <span className={`font-semibold ${valor.apagado ? "italic" : "text-foreground"}`}>· {valor.texto}</span>
          {!edital.visualizado && <span className="rounded-full bg-brand px-1.5 py-0.5 text-[10px] font-bold text-white">Novo</span>}
        </div>
      </Link>
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <div className="min-w-0">
          {etapaAudita(edital.etapaKanban) || edital.habilitacaoStatus === "HABILITADA" || edital.habilitacaoStatus === "NAO_HABILITADA" ? (
            <SeloHabilitacao status={edital.habilitacaoStatus} percentual={edital.habilitacaoPercentual} etapa={edital.etapaKanban} />
          ) : null}
        </div>
        {podeQualificar ? (
          <button onClick={() => onQualificar!(edital)} className="flex-none text-[12px] font-bold text-brand">
            Qualificar →
          </button>
        ) : (
          <Link href={`/editais/${edital.id}`} className="flex-none text-[12px] font-bold text-brand">
            Abrir →
          </Link>
        )}
      </div>
    </div>
  );
}

/**
 * Lista de editais do celular: chips de etapa (com contagem) e cartões. Usada na tela Início e na aba Editais.
 * "Qualificar →" faz o MESMO que arrastar o card para Qualificação no quadro do computador: dispara os agentes e
 * a auditoria de habilitação (usa IA) — por isso pede confirmação antes.
 */
export function ListaEditaisMobile({
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
  const padrao: EtapaKanban | "TODOS" = comBusca ? "TODOS" : ((contagem.get("OPORTUNIDADE") ?? 0) > 0 ? "OPORTUNIDADE" : (etapasVisiveis.find((e) => (contagem.get(e.key) ?? 0) > 0)?.key ?? "OPORTUNIDADE"));
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

  return (
    <div>
      {comBusca && (
        <label className="mt-4 flex h-11 items-center gap-2 rounded-[22px] bg-white px-4 text-sm text-muted">
          <Search className="h-4 w-4 shrink-0" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por objeto, órgão ou cidade"
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted/70 focus:outline-none"
          />
          {busca && (
            <button onClick={() => setBusca("")} aria-label="Limpar busca">
              <X className="h-4 w-4" />
            </button>
          )}
        </label>
      )}

      <div className="rolagem-oculta -mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {comBusca && (
          <button
            onClick={() => setEscolhida("TODOS")}
            className={`flex-none rounded-[18px] px-3.5 py-2 text-[12.5px] font-bold ${etapa === "TODOS" ? "bg-brand text-white" : "bg-white text-muted"}`}
          >
            Todos · {editais.filter((e) => e.etapaKanban !== "RASCUNHO").length}
          </button>
        )}
        {etapasVisiveis.map((e) => (
          <button
            key={e.key}
            onClick={() => setEscolhida(e.key)}
            className={`flex-none whitespace-nowrap rounded-[18px] px-3.5 py-2 text-[12.5px] font-bold ${etapa === e.key ? "bg-brand text-white" : "bg-white text-muted"}`}
          >
            {e.label} · {contagem.get(e.key) ?? 0}
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-col gap-2.5">
        {lista.map((e) => (
          <CartaoEditalMobile key={e.id} edital={e} onQualificar={setParaQualificar} />
        ))}
        {lista.length === 0 && (
          <p className="rounded-[20px] bg-white p-5 text-center text-sm text-muted">
            {busca ? "Nenhum edital encontrado para essa busca." : "Nenhum edital nesta etapa."}
          </p>
        )}
        {limite && totalDaEtapa > lista.length && (
          <Link href={etapa === "TODOS" ? "/editais" : `/editais?etapa=${etapa}`} className="py-1 text-center text-[12.5px] font-bold text-brand">
            Ver todos os {totalDaEtapa} →
          </Link>
        )}
      </div>

      {paraQualificar && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40 p-3" role="dialog" aria-modal="true" aria-label="Qualificar edital">
          <div className="w-full rounded-[24px] bg-white p-5">
            <h3 className="text-lg font-semibold text-foreground">Mover para Qualificação?</h3>
            <p className="mt-1 text-sm text-foreground">{paraQualificar.titulo}</p>
            <p className="mt-2 text-xs text-muted">
              Os agentes vão analisar o edital e a auditoria de habilitação começa em seguida — isso usa IA. É o mesmo que arrastar o
              card para &ldquo;Qualificação&rdquo; no computador.
            </p>
            {erro && <p className="mt-2 text-xs text-danger">{erro}</p>}
            <div className="mt-4 flex gap-2">
              <button onClick={() => setParaQualificar(null)} disabled={movendo} className="h-11 flex-1 rounded-[22px] bg-[#e8e9f3] text-sm font-bold text-foreground">
                Cancelar
              </button>
              <button onClick={confirmarQualificar} disabled={movendo} className="flex h-11 flex-1 items-center justify-center gap-2 rounded-[22px] bg-brand text-sm font-bold text-white">
                {movendo && <Loader2 className="h-4 w-4 animate-spin" />}
                Qualificar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
