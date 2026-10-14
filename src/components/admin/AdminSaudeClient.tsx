"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

type Linha = { agentKey: string; execucoes: number; concluidas: number; falhas: number; taxaErro: number | null };
type Consumo = { agente: string; chamadas: number; entrada: number; saida: number; custoUsd: number };
type Dados = { dias: number; meta: number; geral: Linha; agentes: Linha[]; consumo: Consumo[] };

const NOME: Record<string, string> = {
  "agente1-comercial": "Agente Comercial (busca)",
  "agente2-analista": "Agente Analista",
  "agente3-financeiro": "Agente Financeiro",
  "agente4-advogado": "Agente Advogado",
  "agente5-secretario": "Agente Secretário",
  "agente6-auditor": "Agente Auditor",
  "auditoria-habilitacao": "Auditoria de habilitação",
  geral: "Geral",
  outros: "Outros (chat, estudos, assistente)",
};
const nome = (k: string) => NOME[k] ?? k;
const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1).replace(".", ",")}%`);
const milhar = (n: number) => n.toLocaleString("pt-BR");

export function AdminSaudeClient() {
  const [dias, setDias] = useState(7);
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    fetch(`/api/admin/saude-agentes?dias=${dias}`)
      .then(async (r) => {
        if (!r.ok) throw new Error();
        const d = (await r.json()) as Dados;
        if (!cancelado) {
          setDados(d);
          setErro(null);
        }
      })
      .catch(() => !cancelado && setErro("Não foi possível carregar o painel."));
    return () => {
      cancelado = true;
    };
  }, [dias]);

  const dentroDaMeta = dados?.geral.taxaErro == null ? null : dados.geral.taxaErro <= dados.meta;
  const totalUsd = dados?.consumo.reduce((a, c) => a + c.custoUsd, 0) ?? 0;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <h1 className="text-2xl font-semibold text-foreground">Saúde dos agentes</h1>
      <p className="mt-1 text-sm text-muted">
        Quantas execuções terminaram em erro e quanto a IA consumiu, por agente. A meta é de no máximo{" "}
        <strong>{dados ? pct(dados.meta) : "5%"}</strong> de erro. Só entram execuções que já terminaram.
      </p>

      <div className="mt-4 flex gap-1 rounded-lg border border-border bg-surface/50 p-1 text-xs font-medium sm:w-fit">
        {[1, 7, 30].map((d) => (
          <button
            key={d}
            onClick={() => setDias(d)}
            className={`rounded-md px-3 py-1.5 ${dias === d ? "bg-background text-brand shadow-sm" : "text-muted hover:text-foreground"}`}
          >
            {d === 1 ? "24 horas" : `${d} dias`}
          </button>
        ))}
      </div>

      {erro && <p className="mt-4 text-sm text-danger">{erro}</p>}
      {!dados && !erro && (
        <div className="flex justify-center py-16 text-muted">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      )}

      {dados && (
        <>
          <div
            className={`mt-5 rounded-2xl border p-4 ${
              dentroDaMeta === null ? "border-border" : dentroDaMeta ? "border-accent/40 bg-accent/5" : "border-danger/40 bg-danger/5"
            }`}
          >
            <p className="text-sm text-muted">Taxa de erro geral (agentes do pipeline)</p>
            <p className="mt-1 text-3xl font-semibold text-foreground">{pct(dados.geral.taxaErro)}</p>
            <p className="mt-1 text-xs text-muted">
              {dados.geral.falhas} falha(s) em {dados.geral.execucoes} execução(ões) terminadas —{" "}
              {dentroDaMeta === null ? "sem execuções no período" : dentroDaMeta ? "dentro da meta" : "acima da meta"}.
            </p>
          </div>

          <h2 className="mt-6 text-sm font-semibold text-foreground">Erros por agente</h2>
          <div className="mt-2 overflow-x-auto rounded-2xl border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface/60 text-xs text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Agente</th>
                  <th className="px-3 py-2 font-medium">Execuções</th>
                  <th className="px-3 py-2 font-medium">Erros</th>
                  <th className="px-3 py-2 font-medium">Taxa de erro</th>
                </tr>
              </thead>
              <tbody>
                {dados.agentes.map((a) => (
                  <tr key={a.agentKey} className="border-t border-border">
                    <td className="px-3 py-2 text-foreground">{nome(a.agentKey)}</td>
                    <td className="px-3 py-2 text-muted">{a.execucoes}</td>
                    <td className="px-3 py-2 text-muted">{a.falhas}</td>
                    <td className={`px-3 py-2 font-medium ${a.taxaErro !== null && a.taxaErro > dados.meta ? "text-danger" : "text-foreground"}`}>
                      {pct(a.taxaErro)}
                    </td>
                  </tr>
                ))}
                {dados.agentes.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-4 text-muted">
                      Nenhuma execução no período.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <h2 className="mt-6 text-sm font-semibold text-foreground">Consumo de IA por agente</h2>
          <p className="mt-0.5 text-xs text-muted">
            Custo estimado a preço de lista da Anthropic (US$), só das chamadas registradas a partir do início desta medição.
          </p>
          <div className="mt-2 overflow-x-auto rounded-2xl border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface/60 text-xs text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Agente</th>
                  <th className="px-3 py-2 font-medium">Chamadas</th>
                  <th className="px-3 py-2 font-medium">Tokens (entrada / saída)</th>
                  <th className="px-3 py-2 font-medium">Custo (US$)</th>
                </tr>
              </thead>
              <tbody>
                {dados.consumo.map((c) => (
                  <tr key={c.agente} className="border-t border-border">
                    <td className="px-3 py-2 text-foreground">{nome(c.agente)}</td>
                    <td className="px-3 py-2 text-muted">{milhar(c.chamadas)}</td>
                    <td className="px-3 py-2 text-muted">
                      {milhar(c.entrada)} / {milhar(c.saida)}
                    </td>
                    <td className="px-3 py-2 text-foreground">{c.custoUsd.toFixed(2).replace(".", ",")}</td>
                  </tr>
                ))}
                {dados.consumo.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-4 text-muted">
                      Ainda sem registros — o consumo começa a ser medido a partir das próximas execuções.
                    </td>
                  </tr>
                )}
              </tbody>
              {dados.consumo.length > 0 && (
                <tfoot>
                  <tr className="border-t border-border bg-surface/40">
                    <td className="px-3 py-2 font-medium text-foreground" colSpan={3}>
                      Total
                    </td>
                    <td className="px-3 py-2 font-medium text-foreground">{totalUsd.toFixed(2).replace(".", ",")}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </>
      )}
    </div>
  );
}
