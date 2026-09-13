"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, FileText, Loader2, XCircle } from "lucide-react";
import { formatBRL } from "@/lib/format";
import { REGIME_LABEL } from "@/lib/tributos";
import type { ResultadoCalculoViabilidade, IndicadorViabilidade } from "@/lib/calculo-viabilidade";
import type { ResultadoDreServico } from "@/lib/calculo-dre-servico";
import type { AliquotasResolvidas } from "@/lib/tributos";
import type { RequisitosEstudo, EstudoViabilidadeDetail } from "@/lib/types";

type Decisao = "PARTICIPAR" | "PARTICIPAR_COM_RESSALVAS" | "NAO_PARTICIPAR";

const INDICADOR_CONFIG: Record<IndicadorViabilidade, { label: string; icon: typeof CheckCircle2; className: string }> = {
  VIAVEL: { label: "Viável", icon: CheckCircle2, className: "text-accent bg-accent/10" },
  MARGINAL: { label: "Marginal", icon: AlertTriangle, className: "text-warning bg-warning/10" },
  INVIAVEL: { label: "Inviável", icon: XCircle, className: "text-danger bg-danger/10" },
};

const DECISAO_CONFIG: Record<Decisao, { label: string; className: string }> = {
  PARTICIPAR: { label: "Participar", className: "text-accent" },
  PARTICIPAR_COM_RESSALVAS: { label: "Participar com ressalvas", className: "text-warning" },
  NAO_PARTICIPAR: { label: "Não participar", className: "text-danger" },
};

type RelatorioData = {
  requisitos: RequisitosEstudo | null;
  aliquotas: AliquotasResolvidas | null;
  resultadoCalculo: ResultadoCalculoViabilidade | ResultadoDreServico | null;
};

function isDreServico(r: ResultadoCalculoViabilidade | ResultadoDreServico): r is ResultadoDreServico {
  return "receitaBrutaMensal" in r;
}

/** Etapa 6: resumo consolidado de todas as etapas anteriores + exportação em PDF. */
export function EtapaRelatorio({ estudo }: { estudo: EstudoViabilidadeDetail }) {
  const [dados, setDados] = useState<RelatorioData | null>(null);

  useEffect(() => {
    let cancelado = false;
    fetch(`/api/estudos/${estudo.id}/relatorio`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelado) setDados(data);
      });
    return () => {
      cancelado = true;
    };
  }, [estudo.id]);

  if (!dados) {
    return (
      <div className="flex justify-center py-10 text-muted">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  const { requisitos, aliquotas, resultadoCalculo } = dados;
  const dre = resultadoCalculo && isDreServico(resultadoCalculo) ? resultadoCalculo : null;
  const porItem = resultadoCalculo && !isDreServico(resultadoCalculo) ? resultadoCalculo : null;

  const indicador = dre?.indicador ?? porItem?.consolidado.indicador ?? null;
  const decisao = (dre?.recomendacao.decisao ?? porItem?.recomendacao.decisao ?? null) as Decisao | null;
  const motivo = dre?.recomendacao.motivo ?? porItem?.recomendacao.motivo ?? null;
  const indicadorCfg = indicador ? INDICADOR_CONFIG[indicador] : null;
  const decisaoCfg = decisao ? DECISAO_CONFIG[decisao] : null;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 rounded-xl bg-accent/10 px-4 py-2.5 text-sm text-accent">
        <span className="inline-flex items-center gap-1.5 font-medium">
          <CheckCircle2 className="h-4 w-4" /> Estudo de viabilidade concluído
        </span>
        <a
          href={`/api/estudos/${estudo.id}/relatorio/pdf`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-brand/90"
        >
          <Download className="h-3.5 w-3.5" /> Baixar relatório em PDF
        </a>
      </div>

      {decisaoCfg && indicadorCfg && (
        <div className="rounded-2xl border border-border bg-surface/50 p-5">
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-sm font-semibold text-foreground">Resumo executivo</h4>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${indicadorCfg.className}`}
            >
              <indicadorCfg.icon className="h-3 w-3" /> {indicadorCfg.label}
            </span>
          </div>
          <p className={`mt-3 text-sm font-semibold ${decisaoCfg.className}`}>Recomendação: {decisaoCfg.label}</p>
          <p className="mt-1 text-sm text-foreground/80">{motivo}</p>

          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {dre ? (
              <>
                <div>
                  <p className="text-xs text-muted">Receita bruta mensal</p>
                  <p className="mt-0.5 text-sm font-medium text-foreground">{formatBRL(dre.receitaBrutaMensal)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted">Lucro líquido mensal</p>
                  <p className="mt-0.5 text-sm font-medium text-foreground">{formatBRL(dre.lucroLiquidoMensal)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted">Margem líquida</p>
                  <p className="mt-0.5 text-sm font-medium text-foreground">{dre.margemLiquidaPercentual.toFixed(2)}%</p>
                </div>
                <div>
                  <p className="text-xs text-muted">Regime tributário</p>
                  <p className="mt-0.5 text-sm font-medium text-foreground">{aliquotas ? REGIME_LABEL[aliquotas.regime] : "—"}</p>
                </div>
              </>
            ) : porItem ? (
              <>
                <div>
                  <p className="text-xs text-muted">Preço mínimo viável</p>
                  <p className="mt-0.5 text-sm font-medium text-foreground">
                    {formatBRL(porItem.consolidado.precoMinimoTotal)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted">Valor estimado do edital</p>
                  <p className="mt-0.5 text-sm font-medium text-foreground">
                    {formatBRL(porItem.consolidado.valorTetoTotal)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted">Margem líquida no teto</p>
                  <p className="mt-0.5 text-sm font-medium text-foreground">
                    {porItem.consolidado.margemLiquidaConsolidada.toFixed(2)}%
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted">Regime tributário</p>
                  <p className="mt-0.5 text-sm font-medium text-foreground">{aliquotas ? REGIME_LABEL[aliquotas.regime] : "—"}</p>
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}

      {requisitos && (
        <div className="rounded-2xl border border-border bg-surface/50 p-5">
          <h4 className="text-sm font-semibold text-foreground">Objeto e requisitos</h4>
          <p className="mt-2 text-sm text-foreground/80">{requisitos.objeto}</p>
        </div>
      )}

      <p className="flex items-center gap-1.5 text-xs text-muted">
        <FileText className="h-3.5 w-3.5" /> O PDF completo inclui edital de referência, requisitos, alíquotas
        aplicadas{dre ? " e a DRE detalhada" : " e o detalhamento por item"}.
      </p>
    </div>
  );
}
