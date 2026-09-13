"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, TextInput } from "@/components/ui/Field";
import { formatBRL } from "@/lib/format";
import type { IndicadorViabilidade } from "@/lib/calculo-viabilidade";
import type { ResultadoDreServico } from "@/lib/calculo-dre-servico";
import type { EstudoViabilidadeDetail } from "@/lib/types";

const INDICADOR_CONFIG: Record<IndicadorViabilidade, { label: string; icon: typeof CheckCircle2; className: string }> = {
  VIAVEL: { label: "Viável", icon: CheckCircle2, className: "text-accent bg-accent/10" },
  MARGINAL: { label: "Marginal", icon: AlertTriangle, className: "text-warning bg-warning/10" },
  INVIAVEL: { label: "Inviável", icon: XCircle, className: "text-danger bg-danger/10" },
};

const DECISAO_CONFIG: Record<ResultadoDreServico["recomendacao"]["decisao"], { label: string; className: string }> = {
  PARTICIPAR: { label: "Participar", className: "text-accent" },
  PARTICIPAR_COM_RESSALVAS: { label: "Participar com ressalvas", className: "text-warning" },
  NAO_PARTICIPAR: { label: "Não participar", className: "text-danger" },
};

function LinhaDre({ nome, percentual, valor, destaque }: { nome: string; percentual?: number; valor: number; destaque?: boolean }) {
  return (
    <tr className={destaque ? "font-semibold" : ""}>
      <td className="px-3 py-1.5 text-foreground">{nome}</td>
      <td className="px-3 py-1.5 text-right text-muted">{percentual != null ? `${percentual.toFixed(2)}%` : ""}</td>
      <td className="px-3 py-1.5 text-right text-foreground">{formatBRL(valor)}</td>
    </tr>
  );
}

/** Etapa 5 (ramo Serviço): exibe a DRE mensal calculada (receita, custos operacionais,
 * folha de pagamento, impostos, resultado) e a projeção para a duração do contrato. */
export function EtapaCalculoServico({
  estudo,
  onUpdated,
}: {
  estudo: EstudoViabilidadeDetail;
  onUpdated: (estudo: EstudoViabilidadeDetail) => void;
}) {
  const [recalculando, setRecalculando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoDreServico | null>(null);
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
          hint="Abaixo disso, o estudo é classificado como Marginal; negativo é Inviável."
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
            Calcular DRE
          </Button>
        </div>
      </div>
    );
  }

  const indicadorCfg = INDICADOR_CONFIG[resultado.indicador];
  const decisaoCfg = DECISAO_CONFIG[resultado.recomendacao.decisao];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 rounded-xl bg-accent/10 px-4 py-2.5 text-sm text-accent">
        <span className="inline-flex items-center gap-1.5 font-medium">
          <CheckCircle2 className="h-4 w-4" /> DRE calculada
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
          <h4 className="text-sm font-semibold text-foreground">Resultado mensal</h4>
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${indicadorCfg.className}`}>
            <indicadorCfg.icon className="h-3 w-3" /> {indicadorCfg.label}
          </span>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <p className="text-xs text-muted">Receita bruta mensal</p>
            <p className="mt-0.5 text-sm font-medium text-foreground">{formatBRL(resultado.receitaBrutaMensal)}</p>
          </div>
          <div>
            <p className="text-xs text-muted">Custo total mensal</p>
            <p className="mt-0.5 text-sm font-medium text-foreground">{formatBRL(resultado.custoTotalMensal)}</p>
          </div>
          <div>
            <p className="text-xs text-muted">Lucro líquido mensal</p>
            <p className="mt-0.5 text-sm font-medium text-foreground">{formatBRL(resultado.lucroLiquidoMensal)}</p>
          </div>
          <div>
            <p className="text-xs text-muted">Margem líquida</p>
            <p className={`mt-0.5 text-sm font-semibold ${indicadorCfg.className.split(" ")[0]}`}>
              {resultado.margemLiquidaPercentual.toFixed(2)}%
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-surface/50 p-5">
        <p className={`text-sm font-semibold ${decisaoCfg.className}`}>Recomendação: {decisaoCfg.label}</p>
        <p className="mt-2 text-sm text-foreground/80">{resultado.recomendacao.motivo}</p>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface text-left text-xs font-medium uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-2.5">Item</th>
              <th className="px-3 py-2.5 text-right">% da receita</th>
              <th className="px-3 py-2.5 text-right">Valor mensal (R$)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            <tr className="bg-surface/70">
              <td className="px-3 py-1.5 font-semibold text-foreground" colSpan={3}>
                Receita bruta mensal (desconto de {resultado.descontoPercentual}% sobre o teto de{" "}
                {formatBRL(resultado.valorTetoLote)})
              </td>
            </tr>
            <LinhaDre nome="(=) Receita bruta mensal" percentual={100} valor={resultado.receitaBrutaMensal} destaque />

            <tr className="bg-surface/70">
              <td className="px-3 py-1.5 font-semibold text-foreground" colSpan={3}>
                Custos operacionais diretos
              </td>
            </tr>
            {resultado.custosOperacionais.map((l, i) => (
              <LinhaDre key={i} nome={l.nome} percentual={l.percentualDaReceita} valor={l.valorMensal} />
            ))}
            <LinhaDre nome="Subtotal — Custos Operacionais Diretos" valor={resultado.custosOperacionaisTotal} destaque />

            <tr className="bg-surface/70">
              <td className="px-3 py-1.5 font-semibold text-foreground" colSpan={3}>
                Folha de pagamento (CLT)
              </td>
            </tr>
            {resultado.folhaPagamento.map((l, i) => (
              <LinhaDre
                key={i}
                nome={`${l.nome} (${l.quantidade}× ${formatBRL(l.valorUnitarioMensal)})`}
                percentual={l.percentualDaReceita}
                valor={l.valorMensal}
              />
            ))}
            <LinhaDre nome="Subtotal — Folha de Pagamento (CLT)" valor={resultado.folhaPagamentoTotal} destaque />

            <tr className="bg-surface/70">
              <td className="px-3 py-1.5 font-semibold text-foreground" colSpan={3}>
                Impostos
              </td>
            </tr>
            {resultado.impostos.map((l, i) => (
              <LinhaDre key={i} nome={l.nome} percentual={l.percentualDaReceita} valor={l.valorMensal} />
            ))}
            <LinhaDre nome="Subtotal — Impostos" valor={resultado.impostosTotal} destaque />

            <tr className="bg-surface/70">
              <td className="px-3 py-1.5 font-semibold text-foreground" colSpan={3}>
                Resultado
              </td>
            </tr>
            <LinhaDre nome="(=) Custo total (Operacional + Folha + Impostos)" valor={resultado.custoTotalMensal} destaque />
            <LinhaDre
              nome="(=) Lucro líquido mensal"
              percentual={resultado.margemLiquidaPercentual}
              valor={resultado.lucroLiquidoMensal}
              destaque
            />
          </tbody>
        </table>
      </div>

      <div className="rounded-2xl border border-border bg-surface/50 p-5">
        <h4 className="text-sm font-semibold text-foreground">
          Projeção do contrato ({resultado.duracaoContratoMeses} meses)
        </h4>
        <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted">Valor global do contrato</p>
            <p className="mt-0.5 text-sm font-medium text-foreground">{formatBRL(resultado.valorGlobalContrato)}</p>
          </div>
          <div>
            <p className="text-xs text-muted">Lucro líquido acumulado</p>
            <p className="mt-0.5 text-sm font-medium text-foreground">{formatBRL(resultado.lucroLiquidoAcumulado)}</p>
          </div>
          <div>
            <p className="text-xs text-muted">% do teto utilizado</p>
            <p className="mt-0.5 text-sm font-medium text-foreground">{resultado.percentualTetoUtilizado.toFixed(2)}%</p>
          </div>
        </div>
      </div>

      <div>
        <h4 className="text-sm font-semibold text-foreground">Composição do custo total por categoria</h4>
        <div className="mt-2 overflow-x-auto rounded-2xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs font-medium uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2.5">Categoria</th>
                <th className="px-3 py-2.5 text-right">Valor mensal</th>
                <th className="px-3 py-2.5 text-right">% do custo total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {resultado.composicaoCustoTotal.map((c, i) => (
                <tr key={i}>
                  <td className="px-3 py-1.5 text-foreground">{c.categoria}</td>
                  <td className="px-3 py-1.5 text-right text-foreground">{formatBRL(c.valorMensal)}</td>
                  <td className="px-3 py-1.5 text-right text-muted">{c.percentualDoCustoTotal.toFixed(2)}%</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td className="px-3 py-1.5 text-foreground">Total</td>
                <td className="px-3 py-1.5 text-right text-foreground">{formatBRL(resultado.custoTotalMensal)}</td>
                <td className="px-3 py-1.5 text-right text-foreground">100,00%</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
