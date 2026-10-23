"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Cartao } from "@/components/ui/Cartao";
import { Chip, type TomChip } from "@/components/ui/Chip";
import { PaginaConteudo } from "@/components/ui/PaginaConteudo";
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

const TOM_STATUS: Record<StatusAssinatura, TomChip> = {
  ATIVA: "sucesso",
  EM_TESTE: "info",
  PAGAMENTO_PENDENTE: "atencao",
  CANCELADA: "neutro",
};

function BarraLimite({ titulo, l }: { titulo: string; l: Limite }) {
  const pct = l.limite ? Math.min(100, Math.round((l.atual / l.limite) * 100)) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="tipo-corpo-forte text-ink">{titulo}</span>
        <span className={`tipo-corpo tabular-nums ${l.excedido ? "font-bold text-danger-ink" : "text-ink-muted"}`}>
          {l.limite != null ? `${l.atual} de ${l.limite}` : `${l.atual} · sem limite`}
          {l.excedido && " — acima do limite"}
        </span>
      </div>
      {l.limite != null && (
        <div className="mt-1.5 h-2 rounded-pill bg-neutral-bg" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={titulo}>
          <div className={`h-2 rounded-pill ${l.excedido ? "bg-danger-ink" : "bg-brand-600"}`} style={{ width: `${pct}%` }} />
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
    <PaginaConteudo titulo="Plano e consumo" subtitulo={dados ? `Assinatura: ${ROTULO_STATUS[dados.status].toLowerCase()}` : "Carregando…"}>
      {erro && <p className="text-sm text-danger-ink">Não foi possível carregar os dados do plano.</p>}
      {!dados && !erro && (
        <div className="flex justify-center py-16 text-ink-muted">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      )}
      {dados && (
        <div className="grid gap-3 lg:grid-cols-2 lg:items-start">
          <div className="space-y-3">
            <div className="rounded-card bg-brand-900 p-4 text-on-brand">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="tipo-pequeno text-on-brand/80">Plano atual</p>
                  <p className="tipo-titulo-2 mt-0.5">{dados.plano?.nome ?? "Sem plano definido"}</p>
                  {dados.plano && <p className="tipo-pequeno text-on-brand/80">{formatBRL(dados.plano.precoMensal)} por mês</p>}
                </div>
                <Chip tom={TOM_STATUS[dados.status]}>{ROTULO_STATUS[dados.status]}</Chip>
              </div>
              {dados.status === "EM_TESTE" && dados.emTesteAte && (
                <p className="tipo-pequeno mt-2 font-bold text-accent">Período de teste até {new Date(dados.emTesteAte).toLocaleDateString("pt-BR")}</p>
              )}
            </div>

            <Cartao className="space-y-4">
              <p className="tipo-titulo-3 text-ink">Limites do plano</p>
              <BarraLimite titulo="Editais ativos" l={dados.limites.editaisAtivos} />
              <BarraLimite titulo="Análises no mês" l={dados.limites.analisesNoMes} />
              <p className="tipo-pequeno text-ink-muted">Os limites só avisam; nada é bloqueado.</p>
            </Cartao>

            {dados.funcoes.length > 0 && (
              <Cartao>
                <p className="tipo-titulo-3 text-ink">Funcionalidades do plano</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {dados.funcoes.map((f) => (
                    <Chip key={f.label}>{f.label}</Chip>
                  ))}
                </div>
              </Cartao>
            )}
          </div>

          <Cartao>
            <div className="flex items-baseline justify-between gap-3">
              <p className="tipo-titulo-3 text-ink">Uso dos agentes no mês</p>
              <span className="tipo-pequeno tabular-nums text-ink-muted">{totalExecucoes} execuções</span>
            </div>
            <div className="mt-3 space-y-3">
              {dados.agentes.map((a) => (
                <div key={a.chave}>
                  <div className="flex items-baseline justify-between">
                    <span className="tipo-corpo text-ink">{a.nome}</span>
                    <span className="tipo-corpo tabular-nums text-ink-muted">{a.execucoes}</span>
                  </div>
                  <div className="mt-1 h-2 rounded-pill bg-neutral-bg">
                    <div className="h-2 rounded-pill bg-brand-600" style={{ width: `${Math.round((a.execucoes / maisExecucoes) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </Cartao>
        </div>
      )}
    </PaginaConteudo>
  );
}
