/**
 * Formato dos dados que a rota da aba Viabilidade (`/api/editais/[id]/estudo`) entrega para a tela.
 * Só tipos — nada de lógica — para a rota e a tela falarem exatamente a mesma língua.
 */
import type { AliquotasResolvidas, AnexoSimples, RegimeTributario } from "@/lib/tributos";
import type { RamoEstudo } from "@/lib/estudo-viabilidade";
import type { EstudoViabilidadeDetail } from "@/lib/types";

/** De onde veio o custo que está no campo. */
export type FonteCusto = "SALVO" | "HISTORICO" | "VAZIO";

export type ItemEstudoAba = {
  itemIndex: number;
  numero: number | null;
  descricao: string;
  unidade: string;
  quantidade: number;
  lote: string | null;
  /** Valor unitário de referência do edital. 0 = o órgão não divulgou. */
  valorUnitarioReferencia: number;
  valorTotalReferencia: number;
  /** true quando o valor de referência foi digitado pelo usuário (o edital não divulgou). */
  valorReferenciaManual: boolean;
  /** true quando o edital não tem lista de itens e o estudo é feito pelo valor global. */
  itemGlobal: boolean;
  custos: {
    custoAquisicaoUnitario: number;
    freteLogistica: number;
    icmsStDifal: number;
    fornecedor: string;
  };
  fonteCusto: FonteCusto;
  /** Só quando fonteCusto = HISTORICO: de qual estudo anterior veio a sugestão. */
  sugestao: {
    similaridade: number;
    rotulo: string;
    atualizadoEm: string;
    ocorrencias: number;
    /** Frete e ICMS-ST foram ajustados proporcionalmente à quantidade deste edital. */
    ajustouPorQuantidade: boolean;
  } | null;
};

export type MargensAba = {
  piso: number;
  alvo: number;
  inicial: number;
  /** Despesas comerciais/administrativas (% sobre o custo direto). */
  despesas: number;
  /** SALVO = já gravadas neste estudo; APRENDIDO = mediana dos estudos anteriores; PADRAO = valores de partida. */
  origem: "SALVO" | "APRENDIDO" | "PADRAO";
  amostras: number;
};

export type PacoteProduto = {
  itens: ItemEstudoAba[];
  margens: MargensAba;
  /** null enquanto o regime tributário não foi confirmado. */
  percentualTributos: number | null;
  aliquotas: AliquotasResolvidas | null;
};

export type PacoteAba = {
  edital: {
    id: string;
    titulo: string;
    orgaoNome: string;
    valorGlobal: number | null;
    orcamentoSigiloso: boolean;
    tipoObjeto: "SERVICO" | "BEM" | "AMBOS" | null;
  };
  /** O que o sistema acha que é este edital, pelo tipo do objeto. null = não dá para saber. */
  ramoSugerido: RamoEstudo | null;
  empresa: {
    regimeTributarioPadrao: RegimeTributario | null;
    anexoSimplesPadrao: AnexoSimples | null;
    rbt12Padrao: number | null;
  };
  estudo: EstudoViabilidadeDetail | null;
  /** Só existe quando o estudo é do ramo Produto. */
  produto: PacoteProduto | null;
};

/** Corpo do PUT que salva (rascunho) ou conclui o estudo de produtos. */
export type CorpoSalvarProduto = {
  acao: "rascunho" | "concluir";
  margens: { piso: number; alvo: number; inicial: number; despesas: number };
  itens: {
    itemIndex: number;
    custos: { custoAquisicaoUnitario: number; freteLogistica: number; icmsStDifal: number; fornecedor?: string };
    /** Só vale quando o edital não divulgou o valor do item. */
    valorReferenciaUnitario?: number | null;
  }[];
};
