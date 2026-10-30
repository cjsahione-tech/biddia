/**
 * Motor dos 3 cenários de preço do Estudo de Viabilidade (ramo Produto) — função pura,
 * sem banco nem tela. Reaproveita a MESMA fórmula "por dentro" do motor original
 * (src/lib/calculo-viabilidade.ts):
 *
 *   Preço = (Custo direto + Despesas indiretas) / (1 − %Tributos − %Margem)
 *
 * e a aplica três vezes, com três margens diferentes:
 *
 *   INICIAL = a proposta de abertura: a maior margem que você gostaria de ter. Nunca passa do
 *             valor do edital (ninguém pode propor acima do teto), então é "travada" nele.
 *   ALVO    = a meta: onde você quer fechar.
 *   PISO    = o limite: o menor preço que ainda dá a margem mínima. Abaixo disso, perde dinheiro
 *             (ou ganha menos do que o mínimo que você aceita).
 *
 * Proteções contra o "falso viável": item sem custo informado NÃO é avaliado (status SEM_CUSTO),
 * e item sem valor de referência do edital não recebe veredito (SEM_TETO). Só há veredito do
 * estudo quando todos os itens estão completos.
 */
import { round2, type IndicadorViabilidade, type Recomendacao, type ResultadoCalculoViabilidade } from "@/lib/calculo-viabilidade";
import type { CustoItemProduto } from "@/lib/estudo-custos";

export type NomeCenario = "INICIAL" | "ALVO" | "PISO";
export const ORDEM_CENARIOS: NomeCenario[] = ["INICIAL", "ALVO", "PISO"];
export const ROTULO_CENARIO: Record<NomeCenario, string> = { INICIAL: "Inicial", ALVO: "Alvo", PISO: "Piso" };

export type StatusItem = "VIAVEL_COMPETITIVO" | "DISPUTA_APERTADA" | "INVIAVEL" | "SEM_CUSTO" | "SEM_TETO";
export type StatusEstudo = "VIAVEL_COMPETITIVO" | "DISPUTA_APERTADA" | "INVIAVEL" | "INCOMPLETO";

/** Margens (% sobre a receita) do estudo. Regra: piso ≤ alvo ≤ inicial. */
export type MargensEstudo = { piso: number; alvo: number; inicial: number };

export type ItemCenarioInput = {
  descricao: string;
  quantidade: number;
  /** Valor total de referência do edital para este item (quantidade × valor unitário estimado). 0 = não divulgado. */
  valorTetoTotal: number;
  custos: CustoItemProduto;
};

export type CenarioPreco = {
  nome: NomeCenario;
  /** Margem que você pediu para este cenário (%). */
  margemPedidaPercentual: number;
  /** null quando não tem solução (tributos + margem somam 100% ou mais) ou quando falta custo. */
  precoTotal: number | null;
  precoUnitario: number | null;
  tributosValor: number | null;
  lucroValor: number | null;
  /** Margem líquida real depois de tributos e custos, ao preço mostrado (% da receita). */
  margemLiquidaPercentual: number | null;
  /** Quanto abaixo do valor do edital este preço fica (%). null se o edital não divulga o valor. */
  descontoSobreTetoPercentual: number | null;
  /** O preço calculado passava do teto e foi travado no teto (só acontece no INICIAL). */
  limitadoAoTeto: boolean;
  /** O preço calculado fica acima do teto: não pode ser proposto (ALVO e PISO). */
  acimaDoTeto: boolean;
};

export type ResultadoItemCenario = {
  descricao: string;
  quantidade: number;
  custoDireto: number;
  despesasIndiretas: number;
  custoTotal: number;
  valorTetoTotal: number;
  valorTetoUnitario: number | null;
  cenarios: Record<NomeCenario, CenarioPreco>;
  /** Margem líquida se vender exatamente pelo valor do edital. */
  margemNoTeto: number | null;
  lucroNoTeto: number | null;
  /** Folga para dar lances: quanto dá para baixar do teto (%) até bater no piso. null se não há folga. */
  descontoMaximoPercentual: number | null;
  status: StatusItem;
};

export type ResumoCenarioConsolidado = {
  precoTotal: number | null;
  lucroValor: number | null;
  margemLiquidaPercentual: number | null;
  descontoSobreTetoPercentual: number | null;
};

export type ResultadoConsolidadoCenarios = {
  /** true só quando TODOS os itens têm custo e valor de referência. */
  completo: boolean;
  itensSemCusto: number;
  itensSemTeto: number;
  status: StatusEstudo;
  custoTotal: number;
  valorTetoTotal: number;
  cenarios: Record<NomeCenario, ResumoCenarioConsolidado>;
  margemNoTeto: number | null;
  descontoMaximoPercentual: number | null;
  qtdCompetitivos: number;
  qtdApertados: number;
  qtdInviaveis: number;
};

export type ResultadoCenarios = {
  itens: ResultadoItemCenario[];
  consolidado: ResultadoConsolidadoCenarios;
  percentualTributos: number;
  margens: MargensEstudo;
};

/* ------------------------------------------------------------------ utilidades */

/** Número seguro: NaN, Infinity e negativos viram 0 (entrada digitada nunca derruba a conta). */
function num(n: unknown): number {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0;
}

/** Fórmula "por dentro" — null quando tributos + margem somam 100% ou mais (sem solução). */
function precoPorDentro(custoTotal: number, percentualTributos: number, percentualMargem: number): number | null {
  // Conta feita em "pontos percentuais" e arredondada: 100 − 85 − 15 dá exatamente 0
  // (com 1 − 0,85 − 0,15 o computador sobra 0,00000000000000003 e geraria um preço absurdo).
  const sobra = Math.round((100 - percentualTributos - percentualMargem) * 1e6) / 1e6;
  if (sobra <= 0) return null;
  return (custoTotal * 100) / sobra;
}

function brl(n: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
}

function pct(n: number): string {
  return `${n.toFixed(1).replace(".", ",")}%`;
}

/** Confere as três margens. Devolve a mensagem do problema, ou null se está tudo certo. */
export function validarMargens(m: MargensEstudo, percentualTributos: number): string | null {
  const todas = [m.piso, m.alvo, m.inicial];
  if (todas.some((v) => !Number.isFinite(v) || v < 0)) return "As margens precisam ser números iguais ou maiores que zero.";
  if (m.piso > m.alvo) return "O piso não pode ser maior que o alvo.";
  if (m.alvo > m.inicial) return "O alvo não pode ser maior que a margem inicial.";
  if (m.inicial + percentualTributos >= 100) return "Margem inicial somada aos tributos chega a 100% ou mais — não existe preço que feche a conta.";
  return null;
}

const CENARIO_VAZIO = (nome: NomeCenario, margem: number): CenarioPreco => ({
  nome,
  margemPedidaPercentual: margem,
  precoTotal: null,
  precoUnitario: null,
  tributosValor: null,
  lucroValor: null,
  margemLiquidaPercentual: null,
  descontoSobreTetoPercentual: null,
  limitadoAoTeto: false,
  acimaDoTeto: false,
});

function montarCenario(
  nome: NomeCenario,
  margemPedida: number,
  precoBruto: number | null,
  base: { custoTotal: number; quantidade: number; teto: number; tributos: number },
  travarNoTeto: boolean
): CenarioPreco {
  if (precoBruto == null) return CENARIO_VAZIO(nome, margemPedida);

  let preco = precoBruto;
  let limitadoAoTeto = false;
  if (travarNoTeto && base.teto > 0 && round2(preco) > round2(base.teto)) {
    preco = base.teto;
    limitadoAoTeto = true;
  }

  const tributosValor = (preco * base.tributos) / 100;
  const lucroValor = preco - tributosValor - base.custoTotal;

  return {
    nome,
    margemPedidaPercentual: margemPedida,
    precoTotal: round2(preco),
    precoUnitario: base.quantidade > 0 ? round2(preco / base.quantidade) : null,
    tributosValor: round2(tributosValor),
    lucroValor: round2(lucroValor),
    margemLiquidaPercentual: preco > 0 ? round2((lucroValor / preco) * 100) : null,
    descontoSobreTetoPercentual: base.teto > 0 ? round2(((base.teto - preco) / base.teto) * 100) : null,
    limitadoAoTeto,
    acimaDoTeto: base.teto > 0 && round2(preco) > round2(base.teto),
  };
}

/** Regra única do veredito, usada por item e pelo total. */
function veredito(piso: CenarioPreco, alvo: CenarioPreco): "VIAVEL_COMPETITIVO" | "DISPUTA_APERTADA" | "INVIAVEL" {
  if (piso.precoTotal == null || piso.acimaDoTeto) return "INVIAVEL";
  if (alvo.precoTotal == null || alvo.acimaDoTeto) return "DISPUTA_APERTADA";
  return "VIAVEL_COMPETITIVO";
}

/* ------------------------------------------------------------------ cálculo por item */

export function calcularItemCenarios(input: ItemCenarioInput, percentualTributos: number, margens: MargensEstudo): ResultadoItemCenario {
  const quantidade = num(input.quantidade);
  const teto = num(input.valorTetoTotal);
  const custos = input.custos;

  const custoDireto = num(custos.custoAquisicaoUnitario) * quantidade + num(custos.freteLogistica) + num(custos.icmsStDifal);
  const despesasIndiretas = (custoDireto * num(custos.despesasComerciaisAdmin)) / 100;
  const custoTotal = custoDireto + despesasIndiretas;

  const semCusto = num(custos.custoAquisicaoUnitario) <= 0 || quantidade <= 0 || custoTotal <= 0;
  const base = { custoTotal, quantidade, teto, tributos: percentualTributos };

  const cenarios: Record<NomeCenario, CenarioPreco> = semCusto
    ? {
        INICIAL: CENARIO_VAZIO("INICIAL", margens.inicial),
        ALVO: CENARIO_VAZIO("ALVO", margens.alvo),
        PISO: CENARIO_VAZIO("PISO", margens.piso),
      }
    : {
        INICIAL: montarCenario("INICIAL", margens.inicial, precoPorDentro(custoTotal, percentualTributos, margens.inicial), base, true),
        ALVO: montarCenario("ALVO", margens.alvo, precoPorDentro(custoTotal, percentualTributos, margens.alvo), base, false),
        PISO: montarCenario("PISO", margens.piso, precoPorDentro(custoTotal, percentualTributos, margens.piso), base, false),
      };

  let status: StatusItem;
  if (semCusto) status = "SEM_CUSTO";
  else if (teto <= 0) status = "SEM_TETO";
  else status = veredito(cenarios.PISO, cenarios.ALVO);

  const lucroNoTeto = !semCusto && teto > 0 ? teto - (teto * percentualTributos) / 100 - custoTotal : null;
  const margemNoTeto = lucroNoTeto != null ? round2((lucroNoTeto / teto) * 100) : null;
  const pisoPreco = cenarios.PISO.precoTotal;
  const descontoMaximo =
    !semCusto && teto > 0 && pisoPreco != null && pisoPreco <= teto ? round2(((teto - pisoPreco) / teto) * 100) : null;

  return {
    descricao: input.descricao,
    quantidade,
    custoDireto: round2(custoDireto),
    despesasIndiretas: round2(despesasIndiretas),
    custoTotal: round2(custoTotal),
    valorTetoTotal: round2(teto),
    valorTetoUnitario: quantidade > 0 && teto > 0 ? round2(teto / quantidade) : null,
    cenarios,
    margemNoTeto,
    lucroNoTeto: lucroNoTeto != null ? round2(lucroNoTeto) : null,
    descontoMaximoPercentual: descontoMaximo,
    status,
  };
}

/* ------------------------------------------------------------------ total do estudo */

function somar(itens: ResultadoItemCenario[], nome: NomeCenario, teto: number): ResumoCenarioConsolidado {
  const cenarios = itens.map((i) => i.cenarios[nome]);
  if (cenarios.length === 0 || cenarios.some((c) => c.precoTotal == null || c.lucroValor == null)) {
    return { precoTotal: null, lucroValor: null, margemLiquidaPercentual: null, descontoSobreTetoPercentual: null };
  }
  const preco = cenarios.reduce((acc, c) => acc + (c.precoTotal ?? 0), 0);
  const lucro = cenarios.reduce((acc, c) => acc + (c.lucroValor ?? 0), 0);
  return {
    precoTotal: round2(preco),
    lucroValor: round2(lucro),
    margemLiquidaPercentual: preco > 0 ? round2((lucro / preco) * 100) : null,
    descontoSobreTetoPercentual: teto > 0 ? round2(((teto - preco) / teto) * 100) : null,
  };
}

function consolidar(itens: ResultadoItemCenario[], percentualTributos: number): ResultadoConsolidadoCenarios {
  const itensSemCusto = itens.filter((i) => i.status === "SEM_CUSTO").length;
  const itensSemTeto = itens.filter((i) => i.status === "SEM_TETO").length;
  const avaliados = itens.filter((i) => i.status !== "SEM_CUSTO" && i.status !== "SEM_TETO");
  const completo = itens.length > 0 && itensSemCusto === 0 && itensSemTeto === 0;

  const custoTotal = avaliados.reduce((acc, i) => acc + i.custoTotal, 0);
  const valorTetoTotal = avaliados.reduce((acc, i) => acc + i.valorTetoTotal, 0);

  const cenarios = {
    INICIAL: somar(avaliados, "INICIAL", valorTetoTotal),
    ALVO: somar(avaliados, "ALVO", valorTetoTotal),
    PISO: somar(avaliados, "PISO", valorTetoTotal),
  };

  let status: StatusEstudo = "INCOMPLETO";
  if (completo) {
    const pisoOk = cenarios.PISO.precoTotal != null && cenarios.PISO.precoTotal <= round2(valorTetoTotal);
    const alvoOk = cenarios.ALVO.precoTotal != null && cenarios.ALVO.precoTotal <= round2(valorTetoTotal);
    status = !pisoOk ? "INVIAVEL" : !alvoOk ? "DISPUTA_APERTADA" : "VIAVEL_COMPETITIVO";
  }

  const lucroNoTeto = valorTetoTotal - (valorTetoTotal * percentualTributos) / 100 - custoTotal;
  const pisoTotal = cenarios.PISO.precoTotal;

  return {
    completo,
    itensSemCusto,
    itensSemTeto,
    status,
    custoTotal: round2(custoTotal),
    valorTetoTotal: round2(valorTetoTotal),
    cenarios,
    margemNoTeto: avaliados.length > 0 && valorTetoTotal > 0 ? round2((lucroNoTeto / valorTetoTotal) * 100) : null,
    descontoMaximoPercentual:
      pisoTotal != null && valorTetoTotal > 0 && pisoTotal <= round2(valorTetoTotal)
        ? round2(((valorTetoTotal - pisoTotal) / valorTetoTotal) * 100)
        : null,
    qtdCompetitivos: itens.filter((i) => i.status === "VIAVEL_COMPETITIVO").length,
    qtdApertados: itens.filter((i) => i.status === "DISPUTA_APERTADA").length,
    qtdInviaveis: itens.filter((i) => i.status === "INVIAVEL").length,
  };
}

/** Ponto de entrada: calcula cada item e o total do estudo. */
export function calcularCenarios(itens: ItemCenarioInput[], percentualTributos: number, margens: MargensEstudo): ResultadoCenarios {
  const resultadoItens = itens.map((i) => calcularItemCenarios(i, percentualTributos, margens));
  return { itens: resultadoItens, consolidado: consolidar(resultadoItens, percentualTributos), percentualTributos, margens };
}

/* ------------------------------------------------------------------ textos e ligação com o relatório antigo */

export const ROTULO_STATUS: Record<StatusItem | StatusEstudo, string> = {
  VIAVEL_COMPETITIVO: "Viável e competitivo",
  DISPUTA_APERTADA: "Disputa apertada",
  INVIAVEL: "Inviável",
  SEM_CUSTO: "Falta informar o custo",
  SEM_TETO: "Sem valor de referência",
  INCOMPLETO: "Estudo incompleto",
};

/** Explica o resultado em linguagem simples, com os números do próprio estudo. */
export function explicarResultado(r: ResultadoCenarios): string {
  const c = r.consolidado;
  if (c.status === "INCOMPLETO") {
    const partes: string[] = [];
    if (r.itens.length === 0) partes.push("este estudo ainda não tem itens");
    if (c.itensSemCusto > 0) partes.push(`${c.itensSemCusto} item(ns) sem custo informado`);
    if (c.itensSemTeto > 0) partes.push(`${c.itensSemTeto} item(ns) sem valor de referência do edital`);
    return `Ainda não dá para dizer se vale participar: ${partes.join(" e ")}.`;
  }
  const piso = c.cenarios.PISO.precoTotal ?? 0;
  const alvo = c.cenarios.ALVO.precoTotal ?? 0;
  const teto = c.valorTetoTotal;
  const margemPiso = r.margens.piso;

  if (c.status === "VIAVEL_COMPETITIVO") {
    return `Dá para vender no seu preço alvo (${brl(alvo)}), que fica dentro do valor do edital (${brl(teto)}). Você pode baixar até ${brl(piso)}${
      c.descontoMaximoPercentual != null ? ` (${pct(c.descontoMaximoPercentual)} abaixo do edital)` : ""
    } antes de bater na margem mínima de ${pct(margemPiso)}.`;
  }
  if (c.status === "DISPUTA_APERTADA") {
    return `O seu preço alvo (${brl(alvo)}) fica acima do valor do edital (${brl(teto)}). Dá para participar, mas aceitando margem menor que a meta: vendendo pelo valor do edital a margem líquida seria ${
      c.margemNoTeto != null ? pct(c.margemNoTeto) : "—"
    }, e o seu mínimo é ${pct(margemPiso)}. Pouca folga para dar lances.`;
  }
  return `Mesmo vendendo pelo valor do edital (${brl(teto)}), a margem líquida seria ${
    c.margemNoTeto != null ? pct(c.margemNoTeto) : "—"
  }, abaixo do seu mínimo de ${pct(margemPiso)}. Para ter essa margem, o preço teria de ser ${piso > 0 ? brl(piso) : "maior que o possível"}. Participar nessas condições não compensa.`;
}

function indicadorDoStatus(s: StatusItem): IndicadorViabilidade {
  if (s === "VIAVEL_COMPETITIVO") return "VIAVEL";
  if (s === "DISPUTA_APERTADA") return "MARGINAL";
  return "INVIAVEL";
}

function recomendacaoDoStatus(status: StatusEstudo, motivo: string): Recomendacao {
  if (status === "VIAVEL_COMPETITIVO") return { decisao: "PARTICIPAR", motivo };
  if (status === "DISPUTA_APERTADA") return { decisao: "PARTICIPAR_COM_RESSALVAS", motivo };
  return { decisao: "NAO_PARTICIPAR", motivo };
}

/**
 * Ajusta o resultado do motor ANTIGO (o que o Relatório, o PDF e a lista de estudos já sabem ler)
 * para refletir o veredito novo — assim a aba, o relatório e a lista nunca discordam. Mantém o
 * formato antigo intacto e acrescenta a chave `cenarios` com o detalhe dos 3 cenários.
 */
export function resultadoParaRelatorio(
  legado: ResultadoCalculoViabilidade,
  cenarios: ResultadoCenarios
): ResultadoCalculoViabilidade & { cenarios: ResultadoCenarios } {
  const c = cenarios.consolidado;
  if (c.status === "INCOMPLETO") return { ...legado, cenarios };

  const itens = legado.itens.map((item, i) => ({ ...item, indicador: indicadorDoStatus(cenarios.itens[i]?.status ?? "INVIAVEL") }));
  const indicador = indicadorDoStatus(c.status);

  return {
    ...legado,
    itens,
    consolidado: {
      ...legado.consolidado,
      indicador,
      qtdItensViaveis: c.qtdCompetitivos,
      qtdItensMarginais: c.qtdApertados,
      qtdItensInviaveis: c.qtdInviaveis,
    },
    recomendacao: recomendacaoDoStatus(c.status, explicarResultado(cenarios)),
    margemMinimaAceitavel: cenarios.margens.piso,
    cenarios,
  };
}
