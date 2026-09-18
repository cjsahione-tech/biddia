"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, FileText, TrendingUp, Trophy, Target, XCircle, Clock3, Loader2 } from "lucide-react";
import {
  filtrosParaQueryString,
  FILTROS_PADRAO,
  type ResultadosAgregados,
  type FiltrosResultados,
  type ContagemComValor,
} from "@/lib/resultados";
import { formatBRL } from "@/lib/format";
import { COR_BRAND, COR_ACCENT, COR_GANHO, COR_PERDA } from "@/lib/chart-colors";
import { Filtros } from "@/components/resultados/Filtros";
import { BarraHorizontal, DonutPortal, EvolucaoMensalChart } from "@/components/resultados/Graficos";

function formatPercentual(v: number | null): string {
  return v == null ? "—" : `${(v * 100).toFixed(0)}%`;
}

function formatDias(v: number | null): string {
  if (v == null) return "—";
  return v < 1 ? "< 1 dia" : `${Math.round(v)} dia${Math.round(v) === 1 ? "" : "s"}`;
}

function KpiCard({
  icon: Icon,
  label,
  valor,
  sub,
  cor,
}: {
  icon: typeof TrendingUp;
  label: string;
  valor: string;
  sub?: string;
  cor: string;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-surface/50 p-4">
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: `${cor}1a`, color: cor }}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="truncate text-xs font-medium text-muted">{label}</span>
      </div>
      <p className="mt-2.5 truncate text-xl font-semibold tracking-tight text-foreground" title={valor}>
        {valor}
      </p>
      {sub && <p className="mt-0.5 truncate text-xs text-muted" title={sub}>{sub}</p>}
    </div>
  );
}

function ChartCard({ title, className, children }: { title: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={`rounded-xl border border-border bg-surface/30 p-5 ${className ?? ""}`}>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <div className="mt-4">{children}</div>
    </div>
  );
}

const funilComoContagem = (r: ResultadosAgregados): ContagemComValor[] =>
  r.funil
    .filter((f) => f.quantidade > 0)
    .map((f) => ({ chave: f.etapa, label: f.label, quantidade: f.quantidade, valor: 0 }));

export function ResultadosClient() {
  const [filtros, setFiltros] = useState<FiltrosResultados>(FILTROS_PADRAO);
  const [resultados, setResultados] = useState<ResultadosAgregados | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async (f: FiltrosResultados) => {
    setLoading(true);
    setErro(null);
    try {
      const query = filtrosParaQueryString(f);
      const res = await fetch(`/api/resultados${query ? `?${query}` : ""}`);
      const data = await res.json();
      if (!res.ok) {
        setErro(data.error ?? "Não foi possível carregar os resultados.");
        return;
      }
      setResultados(data.resultados);
    } catch {
      setErro("Não foi possível carregar os resultados.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- busca ao montar e a cada mudança de filtro
    carregar(filtros);
  }, [filtros, carregar]);

  const queryAtual = filtrosParaQueryString(filtros);

  return (
    <div className="mx-auto max-w-[1400px] px-8 py-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Resultados</h1>
          <p className="mt-1 text-sm text-muted">
            Visão consolidada do desempenho da empresa nas licitações — conversão, valores e onde vale mais a pena atuar.
          </p>
        </div>
        <a
          href={`/api/resultados/pdf${queryAtual ? `?${queryAtual}` : ""}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand/90"
        >
          <Download className="h-4 w-4" />
          Exportar PDF
        </a>
      </div>

      {resultados && (
        <Filtros filtros={filtros} onChange={setFiltros} opcoesFiltro={resultados.opcoesFiltro} />
      )}

      {erro && (
        <p className="mt-4 rounded-lg border border-danger/30 bg-danger/5 px-4 py-2.5 text-sm text-danger">{erro}</p>
      )}

      {loading && !resultados ? (
        <div className="flex items-center justify-center py-24 text-muted">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : resultados && resultados.totalGeral === 0 ? (
        <div className="mt-10 rounded-xl border border-dashed border-border py-16 text-center">
          <p className="text-sm text-muted">
            Ainda não há editais suficientes para gerar resultados. Volte aqui depois de captar e decidir sobre alguns editais.
          </p>
        </div>
      ) : resultados ? (
        <>
          {resultados.totalFiltrado === 0 ? (
            <p className="mt-6 rounded-lg border border-border bg-surface px-4 py-2.5 text-sm text-muted">
              Nenhum edital corresponde a esses filtros (de {resultados.totalGeral} no total).
            </p>
          ) : (
            <>
              <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
                <KpiCard
                  icon={FileText}
                  label="Analisados"
                  valor={`${resultados.totalFiltrado}`}
                  sub={resultados.totalFiltrado !== resultados.totalGeral ? `de ${resultados.totalGeral} no total` : undefined}
                  cor={COR_BRAND}
                />
                <KpiCard
                  icon={TrendingUp}
                  label="Taxa de conversão"
                  valor={formatPercentual(resultados.taxaConversao)}
                  sub={`${resultados.ganhos} ganho(s) de ${resultados.ganhos + resultados.perdidos} decidido(s)`}
                  cor={COR_ACCENT}
                />
                <KpiCard
                  icon={Trophy}
                  label="Valor ganho"
                  valor={formatBRL(resultados.valorGanho)}
                  sub={resultados.ticketMedioGanho != null ? `ticket médio ${formatBRL(resultados.ticketMedioGanho)}` : undefined}
                  cor={COR_GANHO}
                />
                <KpiCard
                  icon={Target}
                  label="Em disputa"
                  valor={formatBRL(resultados.valorEmDisputa)}
                  sub={`${resultados.emAndamento} edital(is) em andamento`}
                  cor="#d97706"
                />
                <KpiCard
                  icon={XCircle}
                  label="Valor perdido"
                  valor={formatBRL(resultados.valorPerdido)}
                  sub={`${resultados.perdidos} edital(is) perdido(s)`}
                  cor={COR_PERDA}
                />
                <KpiCard
                  icon={Clock3}
                  label="Tempo médio de decisão"
                  valor={formatDias(resultados.tempoMedioDecisaoDias)}
                  cor={COR_BRAND}
                />
              </div>

              {resultados.qtdSigilosos > 0 && (
                <p className="mt-3 text-xs text-muted">
                  {resultados.qtdSigilosos} edital(is) no filtro têm orçamento sigiloso (sem valor publicado pelo órgão) — os
                  totais de valor acima podem estar subestimados para eles.
                </p>
              )}

              <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
                <ChartCard title="Evolução mensal" className="lg:col-span-2">
                  <EvolucaoMensalChart pontos={resultados.evolucaoMensal} />
                </ChartCard>

                <ChartCard title="Funil por etapa do Kanban">
                  <BarraHorizontal itens={funilComoContagem(resultados)} cor={COR_BRAND} />
                </ChartCard>

                <ChartCard title="Distribuição por portal">
                  <DonutPortal itens={resultados.porPortal} />
                </ChartCard>

                <ChartCard title="Distribuição por estado (UF)">
                  <BarraHorizontal
                    itens={resultados.porUf}
                    cor={COR_ACCENT}
                    sufixoValor={(i) => `${i.quantidade} · ${formatBRL(i.valor)}`}
                  />
                </ChartCard>

                <ChartCard title="Distribuição por tipo de objeto">
                  <BarraHorizontal itens={resultados.porTipoObjeto} />
                </ChartCard>

                <ChartCard title="Principais órgãos licitantes" className="lg:col-span-2">
                  <BarraHorizontal
                    itens={resultados.porOrgao}
                    cor={COR_BRAND}
                    sufixoValor={(i) => `${i.quantidade} · ${formatBRL(i.valor)}`}
                  />
                </ChartCard>
              </div>
            </>
          )}
        </>
      ) : null}
    </div>
  );
}
