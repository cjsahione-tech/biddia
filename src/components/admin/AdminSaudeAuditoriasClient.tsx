"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { mensagemAmigavelDoTipo, type TipoErroIA } from "@/lib/ia-erros";
import type { SaudeAuditorias } from "@/lib/saude-auditorias";

type Dados = SaudeAuditorias & { dias: number; meta: number; tetoCustoUsd: number; tetoCustoLiberadoUsd: number; registroDisponivel: boolean };

const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1).replace(".", ",")}%`);
const usd = (v: number | null) => (v === null ? "—" : `US$ ${v.toFixed(2).replace(".", ",")}`);
const minutos = (v: number | null) => (v === null ? "—" : v < 60 ? `${v.toFixed(1).replace(".", ",")} min` : `${(v / 60).toFixed(1).replace(".", ",")} h`);

const NOME_RESULTADO: Record<string, string> = {
  concluida: "Terminou",
  continua: "Continuou em outra execução",
  retentativa: "Nova tentativa agendada",
  espera: "Guardada (esperando IA ou armazenamento)",
  definitivo: "Erro final",
  acao_humana: "Pediu ajuda de uma pessoa",
  interrompida: "Parou e o vigia retomou",
};
const NOME_METODO: Record<string, string> = { texto: "Só texto", "texto+ocr": "Texto + leitura por imagem", reconferencia: "Só reconferência" };

function Cartao({ titulo, valor, dica, tom }: { titulo: string; valor: number | string; dica: string; tom?: "bom" | "atencao" | "ruim" }) {
  const cor = tom === "bom" ? "text-success-ink" : tom === "atencao" ? "text-warning-ink" : tom === "ruim" ? "text-danger-ink" : "text-foreground";
  return (
    <div className="rounded-card bg-surface shadow-card p-4" title={dica}>
      <p className="text-xs text-muted">{titulo}</p>
      <p className={`mt-1 text-2xl font-semibold ${cor}`}>{valor}</p>
    </div>
  );
}

export function AdminSaudeAuditoriasClient() {
  const [dias, setDias] = useState(7);
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    fetch(`/api/admin/saude-auditorias?dias=${dias}`)
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

  const naMeta = dados?.taxaSozinha == null ? null : dados.taxaSozinha >= dados.meta;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <h1 className="text-2xl font-semibold text-foreground">Saúde das auditorias</h1>
      <p className="mt-1 text-sm text-muted">
        O que aconteceu com as auditorias de habilitação no período. A meta é que <strong>{dados ? pct(dados.meta) : "99%"}</strong> terminem sozinhas, com o resultado certo ou com um aviso claro do que falta.
      </p>

      <div className="mt-4 flex gap-1 rounded-lg border border-border bg-surface/50 p-1 text-xs font-medium sm:w-fit">
        {[1, 7, 30].map((d) => (
          <button key={d} onClick={() => setDias(d)} className={`rounded-md px-3 py-1.5 ${dias === d ? "bg-background text-brand shadow-sm" : "text-muted hover:text-foreground"}`}>
            {d === 1 ? "24 horas" : `${d} dias`}
          </button>
        ))}
      </div>

      {erro && <p className="mt-4 text-sm text-danger-ink">{erro}</p>}
      {!dados && !erro && (
        <div className="flex justify-center py-16 text-muted">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      )}

      {dados && (
        <>
          <div className={`mt-5 rounded-2xl border p-4 ${naMeta === null ? "border-border bg-surface/40" : naMeta ? "border-success-ink/30 bg-success-bg" : "border-danger-ink/30 bg-danger-bg"}`}>
            <p className="text-sm text-muted">Terminaram sozinhas (com resultado ou aviso claro)</p>
            <p className={`mt-1 text-3xl font-semibold ${naMeta === null ? "text-foreground" : naMeta ? "text-success-ink" : "text-danger-ink"}`}>{pct(dados.taxaSozinha)}</p>
            <p className="mt-1 text-xs text-muted">
              {dados.total} auditoria(s) com movimento no período. Erro sem explicação e auditoria travada contam contra a meta; as que ainda estão andando não entram na conta.
            </p>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Cartao titulo="Completas" valor={dados.completas} tom="bom" dica="Leitura completa e resultado dado." />
            <Cartao titulo="Parciais" valor={dados.parciais} tom="atencao" dica="Resultado dado, mas um documento principal não foi lido por inteiro." />
            <Cartao titulo="Revisar manualmente" valor={dados.revisarManualmente} tom="atencao" dica="O resultado parecia bom, mas o sistema não afirma: pede revisão." />
            <Cartao titulo="Precisa de ação" valor={dados.precisaAcao} tom="atencao" dica="Parou e só uma pessoa resolve (enviar arquivo, liberar custo)." />
            <Cartao titulo="Em andamento" valor={dados.emAndamento} dica="Rodando, na fila, esperando serviço ou com nova tentativa agendada." />
            <Cartao titulo="Erro sem explicação" valor={dados.erroFinal} tom={dados.erroFinal > 0 ? "ruim" : "bom"} dica="Erro final sem ação clara: é o que queremos zerar." />
            <Cartao titulo="Travadas" valor={dados.travadas} tom={dados.travadas > 0 ? "ruim" : "bom"} dica="Rodando há mais de 10 minutos sem sinal de vida (o vigia deve retomar)." />
            <Cartao titulo="Tempo mediano" valor={minutos(dados.tempo.medianaMin)} dica={`Tempo médio: ${minutos(dados.tempo.mediaMin)} (a média sobe quando uma auditoria fica parada por muito tempo).`} />
          </div>

          <section className="mt-6 rounded-card bg-surface shadow-card p-4">
            <h2 className="text-sm font-semibold text-foreground">Custo da IA nas auditorias</h2>
            <dl className="mt-2 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs text-muted">Total no período</dt>
                <dd className="font-medium text-foreground">{usd(dados.custo.totalUsd)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Médio por auditoria</dt>
                <dd className="font-medium text-foreground">{usd(dados.custo.medioUsd)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Maior</dt>
                <dd className="font-medium text-foreground">{usd(dados.custo.maximoUsd)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Acima do teto ({usd(dados.tetoCustoUsd)})</dt>
                <dd className={`font-medium ${dados.custo.acimaDoTeto > 0 ? "text-danger-ink" : "text-foreground"}`}>{dados.custo.acimaDoTeto}</dd>
              </div>
            </dl>
            <p className="mt-2 text-xs text-muted">
              Teto por edital: {usd(dados.tetoCustoUsd)}; {usd(dados.tetoCustoLiberadoUsd)} quando o analista libera a leitura completa. Passou do teto, a auditoria para e pede a decisão de uma pessoa.
            </p>
          </section>

          <section className="mt-4 rounded-card bg-surface shadow-card p-4">
            <h2 className="text-sm font-semibold text-foreground">Erros mais comuns</h2>
            {!dados.registroDisponivel && <p className="mt-2 text-xs text-muted">O registro de tentativas ainda não foi ativado no banco; aparece aqui assim que for.</p>}
            {dados.registroDisponivel && dados.errosComuns.length === 0 && <p className="mt-2 text-sm text-muted">Nenhum erro registrado no período.</p>}
            <ul className="mt-2 space-y-2">
              {dados.errosComuns.map((e) => (
                <li key={e.tipo} className="flex items-start justify-between gap-3 text-sm">
                  <span className="min-w-0 text-foreground/90">{mensagemAmigavelDoTipo(e.tipo as TipoErroIA)}</span>
                  <span className="shrink-0 rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-muted">{e.n}×</span>
                </li>
              ))}
            </ul>
          </section>

          {dados.registroDisponivel && dados.tentativas.total > 0 && (
            <section className="mt-4 rounded-card bg-surface shadow-card p-4">
              <h2 className="text-sm font-semibold text-foreground">Tentativas ({dados.tentativas.total})</h2>
              <div className="mt-2 grid gap-4 sm:grid-cols-2">
                <ul className="space-y-1 text-sm">
                  {dados.tentativas.porResultado.map((r) => (
                    <li key={r.resultado} className="flex justify-between gap-3">
                      <span className="text-foreground/90">{NOME_RESULTADO[r.resultado] ?? r.resultado}</span>
                      <span className="text-muted">{r.n}</span>
                    </li>
                  ))}
                </ul>
                <ul className="space-y-1 text-sm">
                  {dados.tentativas.porMetodo.map((m) => (
                    <li key={m.metodo} className="flex justify-between gap-3">
                      <span className="text-foreground/90">{NOME_METODO[m.metodo] ?? m.metodo}</span>
                      <span className="text-muted">{m.n}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
