/**
 * Campos de custo por item/lote (Etapa 4, ramo Produto). Todos os campos numéricos
 * (diretos e percentuais de margem) ficam neste mesmo objeto por item, porque a
 * especificação pede tudo "por item/lote": um botão de "aplicar a todos" cobre o caso
 * comum de repetir o mesmo valor. O ramo Serviço usa a DRE mensal (ver CargoServico e
 * CustoOperacionalLinha abaixo) em vez de custo por item.
 */
export type CustoItemProduto = {
  custoAquisicaoUnitario: number;
  freteLogistica: number;
  icmsStDifal: number;
  despesasComerciaisAdmin: number;
  margemLucroDesejada: number;
};

export type CustoItem = CustoItemProduto;

export const CUSTO_ITEM_VAZIO_PRODUTO: CustoItemProduto = {
  custoAquisicaoUnitario: 0,
  freteLogistica: 0,
  icmsStDifal: 0,
  despesasComerciaisAdmin: 0,
  margemLucroDesejada: 0,
};

export const CAMPOS_CUSTO_PRODUTO: { key: keyof CustoItemProduto; label: string; percentual?: boolean }[] = [
  { key: "custoAquisicaoUnitario", label: "Custo de aquisição unit. (R$)" },
  { key: "freteLogistica", label: "Frete/logística (R$)" },
  { key: "icmsStDifal", label: "ICMS-ST/DIFAL (R$)" },
  { key: "despesasComerciaisAdmin", label: "Desp. comerciais/admin. (%)", percentual: true },
  { key: "margemLucroDesejada", label: "Margem de lucro desejada (%)", percentual: true },
];

/**
 * Ramo Serviço (Etapa 4): um cargo/função exigido para a execução do serviço. `nome` e
 * `quantidade` são sugeridos pela extração por IA a partir do edital/termo de referência
 * (ver extrairCargosServico) quando o texto especificar; quando o edital não indicar
 * quantidade para um cargo, a sugestão vem com quantidade 1 e cabe ao usuário ajustar
 * pela própria experiência — nunca uma suposição silenciosa do sistema.
 */
export type CargoServico = {
  nome: string;
  quantidade: number;
  salarioBase: number;
  percentualEncargos: number;
  beneficiosValor: number;
  origemEdital: boolean;
};

export const CARGO_SERVICO_VAZIO: Omit<CargoServico, "nome" | "origemEdital"> = {
  quantidade: 1,
  salarioBase: 0,
  percentualEncargos: 0,
  beneficiosValor: 0,
};

/** Valor mensal totalmente carregado (salário + encargos + benefícios) de um cargo. */
export function valorMensalUnitarioCargo(cargo: CargoServico): number {
  return cargo.salarioBase * (1 + cargo.percentualEncargos / 100) + cargo.beneficiosValor;
}

/**
 * Linha livre de custo operacional direto (aluguel, insumos, equipamentos etc.) — sem
 * campos fixos, porque esse custo varia demais entre tipos de serviço para engessar no
 * schema. `quantidade`/`valorUnitario` são opcionais só para ajudar a compor o valor
 * mensal (ex: "34.480 tubos × R$0,35"); quando ausentes, o valor mensal é digitado direto.
 */
export type CustoOperacionalLinha = {
  nome: string;
  quantidade: number | null;
  valorUnitario: number | null;
  valorMensal: number;
};
