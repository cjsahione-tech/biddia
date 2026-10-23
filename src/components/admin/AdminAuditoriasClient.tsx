"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import type { SimulacaoRecuperacao } from "@/lib/agents/auditoria-recuperacao";

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const usd = (n: number) => `US$ ${n.toFixed(2).replace(".", ",")}`;

export function AdminAuditoriasClient() {
  const [sim, setSim] = useState<SimulacaoRecuperacao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const res = await fetch("/api/admin/auditorias-recuperacao");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Erro");
      setSim(data.simulacao);
    } catch {
      setErro("Não foi possível simular agora.");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- busca inicial ao abrir a tela
    carregar();
  }, [carregar]);

  async function executar(corpo: object, confirmacao: string) {
    if (!window.confirm(confirmacao)) return;
    setOcupado(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/auditorias-recuperacao", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Erro");
      setMsg(`Feito: ${JSON.stringify(data.resultado)}`);
      await carregar();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Não foi possível executar.");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Auditorias de habilitação — limpeza e recuperação</h1>
          <p className="mt-1 text-sm text-muted">
            A auditoria agora roda só quando o edital entra em Qualificação. Aqui você arruma o passado: primeiro vê a simulação (nada muda, nada gasta), depois decide.
          </p>
        </div>
        <button onClick={carregar} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-surface">
          <RefreshCw className="h-3.5 w-3.5" /> Simular de novo
        </button>
      </div>

      {erro && <p className="text-sm text-danger-ink">{erro}</p>}
      {msg && <p className="rounded-lg border border-border bg-surface/50 p-3 text-sm text-foreground">{msg}</p>}
      {!sim && !erro && <Loader2 className="h-5 w-5 animate-spin text-muted" />}

      {sim && (
        <>
          <section className="rounded-card bg-surface shadow-card p-5">
            <h2 className="text-sm font-semibold text-foreground">Fase A — limpar selos de erro (sem custo)</h2>
            <p className="mt-1 text-sm text-muted">
              <strong className="text-foreground">{sim.limpar.total}</strong> edital(is) ainda antes de Qualificação mostram erro ou “auditando” de tentativas antigas. A limpeza só volta o selo para “será auditado ao qualificar”. Não usa IA e mantém o histórico
              {sim.limpar.auditoriasTravadas > 0 ? ` (${sim.limpar.auditoriasTravadas} auditoria(s) travada(s) ficam marcadas como interrompidas)` : ""}.
            </p>
            {Object.keys(sim.limpar.porSelo).length > 0 && (
              <p className="mt-1 text-xs text-muted">{Object.entries(sim.limpar.porSelo).map(([k, v]) => `${k}: ${v}`).join(" · ")}</p>
            )}
            <button
              disabled={ocupado || sim.limpar.total === 0}
              onClick={() => executar({ acao: "limpar_selos" }, `Limpar o selo de ${sim.limpar.total} edital(is)? Não gasta IA.`)}
              className="mt-3 rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              Limpar {sim.limpar.total} selo(s)
            </button>
          </section>

          <section className="rounded-card bg-surface shadow-card p-5">
            <h2 className="text-sm font-semibold text-foreground">Fase B — auditar editais já em Qualificação ou depois (gasta IA)</h2>
            <p className="mt-1 text-sm text-muted">
              <strong className="text-foreground">{sim.auditar.total}</strong> edital(is) em Qualificação ou depois não têm auditoria válida (nunca auditados, com erro ou travados). Já concluídas (não serão refeitas): {sim.jaConcluidas}. Sem
              documento algum para ler: {sim.semDocumentos}.
            </p>
            <p className="mt-2 text-sm text-foreground">
              Custo estimado: <strong>{brl(sim.auditar.custoBrl.medio)}</strong> ({usd(sim.auditar.custoUsd.medio)}) — faixa de {brl(sim.auditar.custoBrl.minimo)} a {brl(sim.auditar.custoBrl.maximo)}.
              <span className="text-xs text-muted"> Cotação de referência R$ {String(sim.cotacaoUsdBrl).replace(".", ",")}/US$; é estimativa, não cobrança.</span>
            </p>
            {sim.auditar.itens.length > 0 && (
              <details className="mt-3 rounded-lg border border-border">
                <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-foreground">Ver os {sim.auditar.itens.length} edital(is)</summary>
                <ul className="max-h-64 space-y-1 overflow-y-auto border-t border-border px-3 py-2 text-xs text-muted">
                  {sim.auditar.itens.map((i) => (
                    <li key={i.id}>
                      <span className="text-foreground">{i.titulo.slice(0, 80)}</span> — {i.etapa} — {i.situacao}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <button
              disabled={ocupado || sim.auditar.total === 0}
              onClick={() =>
                executar(
                  { acao: "recuperar", confirmarQuantidade: sim.auditar.total },
                  `Auditar ${sim.auditar.total} edital(is)? Custo estimado ${brl(sim.auditar.custoBrl.medio)} (faixa ${brl(sim.auditar.custoBrl.minimo)} a ${brl(sim.auditar.custoBrl.maximo)}). Elas rodam pela fila, 3 por vez.`
                )
              }
              className="mt-3 rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              Auditar {sim.auditar.total} edital(is) — {brl(sim.auditar.custoBrl.medio)}
            </button>
          </section>
        </>
      )}
    </div>
  );
}
