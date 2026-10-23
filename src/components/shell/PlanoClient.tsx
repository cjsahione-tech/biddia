"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { CabecalhoMobile } from "@/components/shell/CabecalhoMobile";
import { formatBRL } from "@/lib/format";
import { ROTULO_STATUS, type StatusAssinatura } from "@/lib/admin-usuarios";

type Limite = { atual: number; limite: number | null; excedido: boolean };
type Resumo = {
  plano: { nome: string; precoMensal: number } | null;
  status: StatusAssinatura;
  emTesteAte: string | null;
  limites: { editaisAtivos: Limite; analisesNoMes: Limite };
  agentes: { chave: string; nome: string; execucoes: number }[];
  funcoes: { label: string; categoria: string }[];
};

const COR_STATUS: Record<StatusAssinatura, string> = {
  ATIVA: "bg-[#ddf3e7] text-[#14532d]",
  EM_TESTE: "bg-brand-light text-[#312e81]",
  PAGAMENTO_PENDENTE: "bg-[#fef3c7] text-[#92400e]",
  CANCELADA: "bg-[#e8e9f3] text-muted",
};

function BarraLimite({ titulo, l }: { titulo: string; l: Limite }) {
  const pct = l.limite ? Math.min(100, Math.round((l.atual / l.limite) * 100)) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-bold text-foreground">{titulo}</span>
        <span className={l.excedido ? "font-bold text-danger-ink" : "text-muted"}>{l.limite != null ? `${l.atual} de ${l.limite}` : `${l.atual} · sem limite`}</span>
      </div>
      {l.limite != null && (
        <div className="mt-1.5 h-1.5 rounded-full bg-[#e3e6ff]">
          <div className={`h-1.5 rounded-full ${l.excedido ? "bg-danger-ink" : "bg-[#fbbf24]"}`} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

/** Tela "Plano e consumo": plano atual, limites e o que cada agente fez no mês, com os dados reais da empresa. */
export function PlanoClient() {
  const [dados, setDados] = useState<Resumo | null>(null);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    let cancelado = false;
    fetch("/api/plano/resumo")
      .then(async (r) => {
        if (!r.ok) throw new Error();
        const d = (await r.json()) as Resumo;
        if (!cancelado) setDados(d);
      })
      .catch(() => !cancelado && setErro(true));
    return () => {
      cancelado = true;
    };
  }, []);

  const maisExecucoes = Math.max(1, ...(dados?.agentes.map((a) => a.execucoes) ?? [1]));
  const totalExecucoes = dados?.agentes.reduce((a, x) => a + x.execucoes, 0) ?? 0;

  return (
    <div className="px-4 pt-5 md:px-8 md:pt-8">
      <CabecalhoMobile titulo="Plano e consumo" subtitulo={dados ? `Assinatura: ${ROTULO_STATUS[dados.status].toLowerCase()}` : "Carregando…"} />
      <h1 className="hidden text-2xl font-semibold text-foreground md:block">Plano e consumo</h1>
      {erro && <p className="mt-4 text-sm text-danger-ink">Não foi possível carregar os dados do plano.</p>}
      {!dados && !erro && (
        <div className="flex justify-center py-16 text-muted">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      )}
      {dados && (
        <div className="mt-4 space-y-3 md:max-w-xl">
          <div className="rounded-[22px] bg-[#312e81] p-4 text-[#f4f5ff]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs text-[#c7d2fe]">Plano atual</p>
                <p className="mt-0.5 font-[family-name:var(--font-rubik)] text-2xl font-semibold">{dados.plano?.nome ?? "Sem plano definido"}</p>
                {dados.plano && <p className="text-xs text-[#c7d2fe]">{formatBRL(dados.plano.precoMensal)} por mês</p>}
              </div>
              <span className={`rounded-[10px] px-2.5 py-1 text-[10.5px] font-bold ${COR_STATUS[dados.status]}`}>{ROTULO_STATUS[dados.status]}</span>
            </div>
            {dados.status === "EM_TESTE" && dados.emTesteAte && (
              <p className="mt-2 text-xs text-[#fbbf24]">Período de teste até {new Date(dados.emTesteAte).toLocaleDateString("pt-BR")}</p>
            )}
          </div>

          <div className="space-y-3.5 rounded-[22px] bg-white p-4">
            <p className="text-[15px] font-bold text-foreground">Limites do plano</p>
            <BarraLimite titulo="Editais ativos" l={dados.limites.editaisAtivos} />
            <BarraLimite titulo="Análises no mês" l={dados.limites.analisesNoMes} />
            <p className="text-[11px] text-muted">Os limites só avisam; nada é bloqueado.</p>
          </div>

          <div className="rounded-[22px] bg-white p-4">
            <div className="flex items-baseline justify-between">
              <p className="text-[15px] font-bold text-foreground">Uso dos agentes no mês</p>
              <span className="text-xs text-muted">{totalExecucoes} execuções</span>
            </div>
            <div className="mt-3 space-y-3">
              {dados.agentes.map((a) => (
                <div key={a.chave}>
                  <div className="flex items-baseline justify-between text-[13px]">
                    <span className="text-foreground">{a.nome}</span>
                    <span className="text-muted">{a.execucoes}</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-[#e3e6ff]">
                    <div className="h-1.5 rounded-full bg-brand" style={{ width: `${Math.round((a.execucoes / maisExecucoes) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {dados.funcoes.length > 0 && (
            <div className="rounded-[22px] bg-white p-4">
              <p className="text-[15px] font-bold text-foreground">Funcionalidades do plano</p>
              <div className="mt-2.5 flex flex-wrap gap-2">
                {dados.funcoes.map((f) => (
                  <span key={f.label} className="rounded-[10px] bg-brand-light px-2.5 py-1 text-[11.5px] font-bold text-[#312e81]">
                    {f.label}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
