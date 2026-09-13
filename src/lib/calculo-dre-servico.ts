/**
 * Motor de cálculo do Estudo de Viabilidade para o ramo Serviço — função pura e isolada
 * da UI/banco, no mesmo espírito de calculo-viabilidade.ts (ramo Produto). Em vez de um
 * preço mínimo por item, o ramo Serviço projeta uma DRE mensal (receita do lance menos
 * custos operacionais, folha de pagamento e impostos) e extrapola para a duração do
 * contrato — é o formato usado em estudos reais de terceirização/serviços continuados.
 */
import type { CargoServico, CustoOperacionalLinha } from "@/lib/estudo-custos";
import { valorMensalUnitarioCargo } from "@/lib/estudo-custos";
import { round2, classificarIndicador, type IndicadorViabilidade } from "@/lib/calculo-viabilidade";
import type { AliquotasResolvidas } from "@/lib/tributos";

export type LinhaCustoOperacionalCalculada = { nome: string; valorMensal: number; percentualDaReceita: number };
export type LinhaFolhaCalculada = {
  nome: string;
  quantidade: number;
  valorUnitarioMensal: number;
  valorMensal: number;
  percentualDaReceita: number;
};
export type LinhaImposto = { nome: string; percentual: number; valorMensal: number; percentualDaReceita: number };
export type LinhaComposicaoCusto = { categoria: string; valorMensal: number; percentualDoCustoTotal: number };

export type ResultadoDreServico = {
  valorTetoLote: number;
  descontoPercentual: number;
  receitaBrutaMensal: number;

  custosOperacionais: LinhaCustoOperacionalCalculada[];
  custosOperacionaisTotal: number;

  folhaPagamento: LinhaFolhaCalculada[];
  folhaPagamentoTotal: number;

  impostos: LinhaImposto[];
  impostosTotal: number;

  custoTotalMensal: number;
  lucroLiquidoMensal: number;
  margemLiquidaPercentual: number;

  duracaoContratoMeses: number;
  valorGlobalContrato: number;
  lucroLiquidoAcumulado: number;
  percentualTetoUtilizado: number;

  composicaoCustoTotal: LinhaComposicaoCusto[];

  margemMinimaAceitavel: number;
  indicador: IndicadorViabilidade;
  recomendacao: { decisao: "PARTICIPAR" | "PARTICIPAR_COM_RESSALVAS" | "NAO_PARTICIPAR"; motivo: string };
};

const LABEL_DETALHE: Record<string, string> = {
  issOuIcms: "ISS",
  pis: "PIS",
  cofins: "COFINS",
  irpjCsll: "IRPJ + CSLL",
};

/** Excedente mensal sobre a base de presunção do IRPJ (RIR/2018, art. 606) — só calculado
 * quando a empresa configurou a base de presunção da atividade; sem isso, a linha nem
 * aparece (nenhuma suposição de atividade é feita silenciosamente). */
const LIMITE_MENSAL_BASE_PRESUNCAO_IRPJ = 20_000;
const ALIQUOTA_IRPJ_ADICIONAL = 0.1;

function calcularImpostos(receitaBrutaMensal: number, aliquotas: AliquotasResolvidas): LinhaImposto[] {
  const linha = (nome: string, percentual: number): LinhaImposto => {
    const valorMensal = round2((receitaBrutaMensal * percentual) / 100);
    return { nome, percentual, valorMensal, percentualDaReceita: percentual };
  };

  if (aliquotas.regime === "SIMPLES_NACIONAL") {
    return [linha("Simples Nacional (DAS)", aliquotas.aliquotaTotalEfetiva)];
  }

  const linhas = Object.entries(aliquotas.detalhes)
    .filter(([chave]) => chave in LABEL_DETALHE)
    .map(([chave, percentual]) => linha(LABEL_DETALHE[chave] ?? chave, percentual));

  if (aliquotas.baseCalculoPresumidoPercentual != null && aliquotas.baseCalculoPresumidoPercentual > 0) {
    const basePresumida = (receitaBrutaMensal * aliquotas.baseCalculoPresumidoPercentual) / 100;
    const excedente = Math.max(0, basePresumida - LIMITE_MENSAL_BASE_PRESUNCAO_IRPJ);
    const adicional = round2(excedente * ALIQUOTA_IRPJ_ADICIONAL);
    if (adicional > 0) {
      linhas.push({
        nome: `IRPJ adicional (10% sobre excedente de R$ ${LIMITE_MENSAL_BASE_PRESUNCAO_IRPJ.toLocaleString("pt-BR")} da base presumida)`,
        percentual: round2((adicional / receitaBrutaMensal) * 100),
        valorMensal: adicional,
        percentualDaReceita: round2((adicional / receitaBrutaMensal) * 100),
      });
    }
  }

  return linhas;
}

function gerarRecomendacaoDre(
  indicador: IndicadorViabilidade,
  margemLiquidaPercentual: number,
  margemMinimaAceitavel: number,
  lucroLiquidoMensal: number
): ResultadoDreServico["recomendacao"] {
  if (indicador === "INVIAVEL") {
    return {
      decisao: "NAO_PARTICIPAR",
      motivo: `Com o desconto e os custos informados, o resultado mensal projetado é negativo (R$ ${lucroLiquidoMensal.toFixed(2)}, margem de ${margemLiquidaPercentual.toFixed(2)}%) — participar nessas condições geraria prejuízo mês a mês.`,
    };
  }
  if (indicador === "MARGINAL") {
    return {
      decisao: "PARTICIPAR_COM_RESSALVAS",
      motivo: `A margem líquida mensal projetada (${margemLiquidaPercentual.toFixed(2)}%) fica abaixo do mínimo aceitável definido (${margemMinimaAceitavel.toFixed(2)}%) — viável, mas com pouca folga para reajustes de custo ao longo do contrato.`,
    };
  }
  return {
    decisao: "PARTICIPAR",
    motivo: `A margem líquida mensal projetada (${margemLiquidaPercentual.toFixed(2)}%) está acima do mínimo aceitável (${margemMinimaAceitavel.toFixed(2)}%), com lucro líquido de R$ ${lucroLiquidoMensal.toFixed(2)}/mês.`,
  };
}

export function calcularDreServico(input: {
  valorTetoLote: number;
  descontoPercentual: number;
  duracaoContratoMeses: number;
  cargos: CargoServico[];
  custosOperacionais: CustoOperacionalLinha[];
  aliquotas: AliquotasResolvidas;
  margemMinimaAceitavel: number;
}): ResultadoDreServico {
  const receitaBrutaMensal = round2(input.valorTetoLote * (1 - input.descontoPercentual / 100));
  const receitaParaPercentual = receitaBrutaMensal > 0 ? receitaBrutaMensal : 1;

  const custosOperacionais: LinhaCustoOperacionalCalculada[] = input.custosOperacionais.map((linha) => ({
    nome: linha.nome,
    valorMensal: round2(linha.valorMensal),
    percentualDaReceita: round2((linha.valorMensal / receitaParaPercentual) * 100),
  }));
  const custosOperacionaisTotal = round2(custosOperacionais.reduce((acc, l) => acc + l.valorMensal, 0));

  const folhaPagamento: LinhaFolhaCalculada[] = input.cargos.map((cargo) => {
    const valorUnitarioMensal = round2(valorMensalUnitarioCargo(cargo));
    const valorMensal = round2(cargo.quantidade * valorUnitarioMensal);
    return {
      nome: cargo.nome,
      quantidade: cargo.quantidade,
      valorUnitarioMensal,
      valorMensal,
      percentualDaReceita: round2((valorMensal / receitaParaPercentual) * 100),
    };
  });
  const folhaPagamentoTotal = round2(folhaPagamento.reduce((acc, l) => acc + l.valorMensal, 0));

  const impostos = calcularImpostos(receitaBrutaMensal, input.aliquotas);
  const impostosTotal = round2(impostos.reduce((acc, l) => acc + l.valorMensal, 0));

  const custoTotalMensal = round2(custosOperacionaisTotal + folhaPagamentoTotal + impostosTotal);
  const lucroLiquidoMensal = round2(receitaBrutaMensal - custoTotalMensal);
  const margemLiquidaPercentual = round2((lucroLiquidoMensal / receitaParaPercentual) * 100);
  const indicador = classificarIndicador(margemLiquidaPercentual, input.margemMinimaAceitavel);

  const composicaoCustoTotal: LinhaComposicaoCusto[] = [
    { categoria: "Custos Operacionais Diretos", valorMensal: custosOperacionaisTotal },
    { categoria: "Folha de Pagamento (CLT)", valorMensal: folhaPagamentoTotal },
    { categoria: "Impostos", valorMensal: impostosTotal },
  ].map((c) => ({ ...c, percentualDoCustoTotal: round2((c.valorMensal / (custoTotalMensal || 1)) * 100) }));

  return {
    valorTetoLote: round2(input.valorTetoLote),
    descontoPercentual: input.descontoPercentual,
    receitaBrutaMensal,
    custosOperacionais,
    custosOperacionaisTotal,
    folhaPagamento,
    folhaPagamentoTotal,
    impostos,
    impostosTotal,
    custoTotalMensal,
    lucroLiquidoMensal,
    margemLiquidaPercentual,
    duracaoContratoMeses: input.duracaoContratoMeses,
    valorGlobalContrato: round2(receitaBrutaMensal * input.duracaoContratoMeses),
    lucroLiquidoAcumulado: round2(lucroLiquidoMensal * input.duracaoContratoMeses),
    percentualTetoUtilizado: round2(100 - input.descontoPercentual),
    composicaoCustoTotal,
    margemMinimaAceitavel: input.margemMinimaAceitavel,
    indicador,
    recomendacao: gerarRecomendacaoDre(indicador, margemLiquidaPercentual, input.margemMinimaAceitavel, lucroLiquidoMensal),
  };
}
