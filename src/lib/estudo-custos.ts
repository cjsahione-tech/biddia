/**
 * Campos de custo por item/lote (Etapa 4) — o formato varia por ramo. Todos os campos
 * numéricos (diretos e percentuais de BDI/margem) ficam neste mesmo objeto por item,
 * inclusive os de BDI/margem, porque a especificação pede tudo "por item/lote": um
 * botão de "aplicar a todos" cobre o caso comum de repetir o mesmo valor.
 */
export type CustoItemServico = {
  quantidadeProfissionais: number;
  salarioBase: number;
  percentualEncargos: number;
  insumos: number;
  equipamentos: number;
  deslocamento: number;
  administracaoCentral: number;
  seguroGarantia: number;
  risco: number;
  despesasFinanceiras: number;
  lucroDesejado: number;
};

export type CustoItemProduto = {
  custoAquisicaoUnitario: number;
  freteLogistica: number;
  icmsStDifal: number;
  despesasComerciaisAdmin: number;
  margemLucroDesejada: number;
};

export type CustoItem = CustoItemServico | CustoItemProduto;

export const CUSTO_ITEM_VAZIO_SERVICO: CustoItemServico = {
  quantidadeProfissionais: 0,
  salarioBase: 0,
  percentualEncargos: 0,
  insumos: 0,
  equipamentos: 0,
  deslocamento: 0,
  administracaoCentral: 0,
  seguroGarantia: 0,
  risco: 0,
  despesasFinanceiras: 0,
  lucroDesejado: 0,
};

export const CUSTO_ITEM_VAZIO_PRODUTO: CustoItemProduto = {
  custoAquisicaoUnitario: 0,
  freteLogistica: 0,
  icmsStDifal: 0,
  despesasComerciaisAdmin: 0,
  margemLucroDesejada: 0,
};

export const CAMPOS_CUSTO_SERVICO: { key: keyof CustoItemServico; label: string; percentual?: boolean }[] = [
  { key: "quantidadeProfissionais", label: "Qtd. profissionais" },
  { key: "salarioBase", label: "Salário-base (R$)" },
  { key: "percentualEncargos", label: "Encargos sociais (%)", percentual: true },
  { key: "insumos", label: "Insumos/materiais (R$)" },
  { key: "equipamentos", label: "Equipamentos (R$)" },
  { key: "deslocamento", label: "Deslocamento (R$)" },
  { key: "administracaoCentral", label: "BDI — Adm. central (%)", percentual: true },
  { key: "seguroGarantia", label: "BDI — Seguro/Garantia (%)", percentual: true },
  { key: "risco", label: "BDI — Risco (%)", percentual: true },
  { key: "despesasFinanceiras", label: "BDI — Desp. financeiras (%)", percentual: true },
  { key: "lucroDesejado", label: "BDI — Lucro desejado (%)", percentual: true },
];

export const CAMPOS_CUSTO_PRODUTO: { key: keyof CustoItemProduto; label: string; percentual?: boolean }[] = [
  { key: "custoAquisicaoUnitario", label: "Custo de aquisição unit. (R$)" },
  { key: "freteLogistica", label: "Frete/logística (R$)" },
  { key: "icmsStDifal", label: "ICMS-ST/DIFAL (R$)" },
  { key: "despesasComerciaisAdmin", label: "Desp. comerciais/admin. (%)", percentual: true },
  { key: "margemLucroDesejada", label: "Margem de lucro desejada (%)", percentual: true },
];
