"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, FileText, Loader2, XCircle } from "lucide-react";
import { formatBRL } from "@/lib/format";
import { REGIME_LABEL } from "@/lib/tributos";
import type { ResultadoCalculoViabilidade, IndicadorViabilidade } from "@/lib/calculo-viabilidade";
import type { AliquotasResolvidas } from "@/lib/tributos";
import type { RequisitosEstudo, EstudoViabilidadeDetail } from "@/lib/types";

const INDICADOR_CONFIG: Record<IndicadorViabilidade, { label: string; icon: typeof CheckCircle2; className: string }> = {
  VIAVEL: { label: "Viável", icon: CheckCircle2, className: "text-accent bg-accent/10" },
  MARGINAL: { label: "Marginal", icon: AlertTriangle, className: "text-warning bg-warning/10" },
  INVIAVEL: { label: "Inviável", icon: XCircle, className: "text-danger bg-danger/10" },
};

const DECISAO_CONFIG: Record<ResultadoCalculoViabilidade["recomendacao"]["decisao"], { label: string; className: string }> = {
  PARTICIPAR: { label: "Participar", className: "text-accent" },
  PARTICIPAR_COM_RESSALVAS: { label: "Participar com ressalvas", className: "text-warning" },
  NAO_PARTICIPAR: { label: "Não participar", className: "text-danger" },
};

type RelatorioData = {
  requisitos: RequisitosEstudo | null;
  aliquotas: AliquotasResolvidas | null;
  resultadoCalculo: ResultadoCalculoViabilidade | null;
};

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
  const decisaoCfg = resultadoCalculo ? DECISAO_CONFIG[resultadoCalculo.recomendacao.decisao] : null;
  const indicadorCfg = resultadoCalculo ? INDICADOR_CONFIG[resultadoCalculo.consolidado.indicador] : null;

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

      {resultadoCalculo && decisaoCfg && indicadorCfg && (
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
          <p className="mt-1 text-sm text-foreground/80">{resultadoCalculo.recomendacao.motivo}</p>

          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="text-xs text-muted">Preço mínimo viável</p>
              <p className="mt-0.5 text-sm font-medium text-foreground">
                {formatBRL(resultadoCalculo.consolidado.precoMinimoTotal)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted">Valor estimado do edital</p>
              <p className="mt-0.5 text-sm font-medium text-foreground">
                {formatBRL(resultadoCalculo.consolidado.valorTetoTotal)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted">Margem líquida no teto</p>
              <p className="mt-0.5 text-sm font-medium text-foreground">
                {resultadoCalculo.consolidado.margemLiquidaConsolidada.toFixed(2)}%
              </p>
            </div>
            <div>
              <p className="text-xs text-muted">Regime tributário</p>
              <p className="mt-0.5 text-sm font-medium text-foreground">
                {aliquotas ? REGIME_LABEL[aliquotas.regime] : "—"}
              </p>
            </div>
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
        aplicadas e o detalhamento por item.
      </p>
    </div>
  );
}
