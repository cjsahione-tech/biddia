"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, TextInput } from "@/components/ui/Field";
import { formatBRL } from "@/lib/format";
import type { ResultadoCalculoViabilidade, IndicadorViabilidade } from "@/lib/calculo-viabilidade";
import type { EstudoViabilidadeDetail } from "@/lib/types";

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

function Badge({ indicador }: { indicador: IndicadorViabilidade }) {
  const cfg = INDICADOR_CONFIG[indicador];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${cfg.className}`}>
      <cfg.icon className="h-3 w-3" /> {cfg.label}
    </span>
  );
}

/** Etapa 5 (ramo Produto): motor de cálculo por item — chama a API (que por sua vez
 * chama a função pura em src/lib/calculo-viabilidade.ts), exibe o resultado por item e
 * consolidado. */
export function EtapaCalculoProduto({
  estudo,
  onUpdated,
}: {
  estudo: EstudoViabilidadeDetail;
  onUpdated: (estudo: EstudoViabilidadeDetail) => void;
}) {
  const [recalculando, setRecalculando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoCalculoViabilidade | null>(null);
  const [loading, setLoading] = useState(true);
  const [margem, setMargem] = useState(estudo.margemMinimaAceitavel != null ? String(estudo.margemMinimaAceitavel) : "10");
  const [erro, setErro] = useState<string | null>(null);
  const [calculando, setCalculando] = useState(false);

  useEffect(() => {
    fetch(`/api/estudos/${estudo.id}/calculo`)
      .then((r) => r.json())
      .then((data) => {
        if (data.resultado) setResultado(data.resultado);
      })
      .finally(() => setLoading(false));
  }, [estudo.id]);

  async function calcular() {
    const margemNum = Number(margem);
    if (Number.isNaN(margemNum) || margemNum < 0 || margemNum >= 100) {
      setErro("Informe uma margem mínima aceitável válida (0 a 99%).");
      return;
    }
    setCalculando(true);
    setErro(null);
    try {
      const res = await fetch(`/api/estudos/${estudo.id}/calculo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ margemMinimaAceitavel: margemNum }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErro(data.error ?? "Não foi possível calcular a viabilidade.");
        return;
      }
      setResultado(data.resultado);
      onUpdated({ ...estudo, calculoConfirmadoEm: new Date().toISOString(), margemMinimaAceitavel: margemNum });
      setRecalculando(false);
    } finally {
      setCalculando(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-10 text-muted">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (!resultado || recalculando) {
    return (
      <div className="rounded-2xl border border-border bg-surface/50 p-5">
        <Field
          label="Margem mínima aceitável (%)"
          htmlFor="margemMinima"
          hint="Abaixo disso, um item/estudo é classificado como Marginal; negativo é Inviável."
        >
          <TextInput
            id="margemMinima"
            type="number"
            min={0}
            max={99}
            step={0.5}
            value={margem}
            onChange={(e) => setMargem(e.target.value)}
          />
        </Field>
        {erro && <p className="mt-2 text-xs text-danger">{erro}</p>}
        <div className="mt-4 flex justify-end">
          <Button onClick={calcular} loading={calculando}>
            Calcular viabilidade
          </Button>
        </div>
      </div>
    );
  }

  const { consolidado, recomendacao } = resultado;
  const decisaoCfg = DECISAO_CONFIG[recomendacao.decisao];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 rounded-xl bg-accent/10 px-4 py-2.5 text-sm text-accent">
        <span className="inline-flex items-center gap-1.5 font-medium">
          <CheckCircle2 className="h-4 w-4" /> Viabilidade calculada
        </span>
        <button
          onClick={() => setRecalculando(true)}
          className="inline-flex items-center gap-1 text-xs font-medium hover:underline"
        >
          <RefreshCw className="h-3 w-3" /> Recalcular
        </button>
      </div>

      <div className="rounded-2xl border border-border bg-surface/50 p-5">
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-sm font-semibold text-foreground">Resultado consolidado</h4>
          <Badge indicador={consolidado.indicador} />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <p className="text-xs text-muted">Custo total (direto + indireto)</p>
            <p className="mt-0.5 text-sm font-medium text-foreground">
              {formatBRL(consolidado.custoDiretoTotal + consolidado.despesasIndiretasTotal)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted">Preço mínimo viável</p>
            <p className="mt-0.5 text-sm font-medium text-foreground">{formatBRL(consolidado.precoMinimoTotal)}</p>
          </div>
          <div>
            <p className="text-xs text-muted">Valor estimado do edital (teto)</p>
            <p className="mt-0.5 text-sm font-medium text-foreground">{formatBRL(consolidado.valorTetoTotal)}</p>
          </div>
          <div>
            <p className="text-xs text-muted">Margem líquida no teto</p>
            <p className={`mt-0.5 text-sm font-semibold ${INDICADOR_CONFIG[consolidado.indicador].className.split(" ")[0]}`}>
              {consolidado.margemLiquidaConsolidada.toFixed(2)}%
            </p>
          </div>
        </div>

        <p className="mt-4 text-xs text-muted">
          {consolidado.qtdItensViaveis} item(ns) viável(is), {consolidado.qtdItensMarginais} marginal(is),{" "}
          {consolidado.qtdItensInviaveis} inviável(is).
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-surface/50 p-5">
        <p className={`text-sm font-semibold ${decisaoCfg.className}`}>Recomendação: {decisaoCfg.label}</p>
        <p className="mt-2 text-sm text-foreground/80">{recomendacao.motivo}</p>
      </div>

      <div>
        <h4 className="text-sm font-semibold text-foreground">Detalhamento por item</h4>
        <div className="mt-2 max-h-[28rem] overflow-auto rounded-2xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs font-medium uppercase tracking-wide text-muted">
              <tr>
                <th className="sticky left-0 z-10 bg-surface px-4 py-2.5">Item</th>
                <th className="whitespace-nowrap px-3 py-2.5 text-right">Custo total</th>
                <th className="whitespace-nowrap px-3 py-2.5 text-right">Preço mínimo</th>
                <th className="whitespace-nowrap px-3 py-2.5 text-right">Teto do edital</th>
                <th className="whitespace-nowrap px-3 py-2.5 text-right">Ponto de equilíbrio</th>
                <th className="whitespace-nowrap px-3 py-2.5 text-right">Margem no teto</th>
                <th className="whitespace-nowrap px-3 py-2.5 text-right">Sensib. −10% custo</th>
                <th className="whitespace-nowrap px-3 py-2.5 text-right">Sensib. +10% custo</th>
                <th className="px-3 py-2.5 text-center">Situação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {resultado.itens.map((item, i) => (
                <tr key={i}>
                  <td
                    className="sticky left-0 z-10 max-w-[200px] truncate bg-background px-4 py-2 text-foreground"
                    title={item.descricao}
                  >
                    {item.descricao}
                  </td>
                  <td className="px-3 py-2 text-right text-muted">
                    {formatBRL(item.custoDireto + item.despesasIndiretas)}
                  </td>
                  <td className="px-3 py-2 text-right text-foreground">
                    {item.precoMinimoViavel != null ? formatBRL(item.precoMinimoViavel) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right text-muted">{formatBRL(item.valorTetoEdital)}</td>
                  <td className="px-3 py-2 text-right text-muted">
                    {item.pontoEquilibrio != null ? formatBRL(item.pontoEquilibrio) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right text-foreground">{item.margemLiquidaNoTeto.toFixed(1)}%</td>
                  <td className="px-3 py-2 text-right text-muted">
                    {item.sensibilidade.custoMenos10.margemLiquidaPercentual.toFixed(1)}%
                  </td>
                  <td className="px-3 py-2 text-right text-muted">
                    {item.sensibilidade.custoMais10.margemLiquidaPercentual.toFixed(1)}%
                  </td>
                  <td className="px-3 py-2 text-center">
                    <Badge indicador={item.indicador} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
