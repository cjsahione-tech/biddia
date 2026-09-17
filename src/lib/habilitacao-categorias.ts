import type { HabilitacaoCategoria } from "@/lib/types";

// Ordem de exibição na tela e no ZIP — segue a sequência usual da Lei 14.133/2021
// (regularidade fiscal/trabalhista/econômico-financeira/jurídica como um bloco só,
// depois as qualificações técnicas, e por fim garantia contratual, quando exigida).
export const ORDEM_CATEGORIAS: HabilitacaoCategoria[] = [
  "FISCAL_TRABALHISTA_ECONOMICO_FINANCEIRA_JURIDICA",
  "QUALIFICACAO_TECNICA_EMPRESA",
  "QUALIFICACAO_EQUIPE_TECNICA",
  "GARANTIA_CONTRATO",
];

export const LABEL_CATEGORIA: Record<HabilitacaoCategoria, string> = {
  FISCAL_TRABALHISTA_ECONOMICO_FINANCEIRA_JURIDICA: "Regularidade Fiscal, Trabalhista, Econômico-Financeira e Jurídica",
  QUALIFICACAO_TECNICA_EMPRESA: "Qualificação Técnica da Empresa",
  QUALIFICACAO_EQUIPE_TECNICA: "Qualificação da Equipe Técnica",
  GARANTIA_CONTRATO: "Garantia do Contrato",
};

export const LABEL_OUTROS = "Outros documentos";

const NOME_PASTA: Record<HabilitacaoCategoria, string> = {
  FISCAL_TRABALHISTA_ECONOMICO_FINANCEIRA_JURIDICA: "01 - Regularidade Fiscal Trabalhista Economico-Financeira e Juridica",
  QUALIFICACAO_TECNICA_EMPRESA: "02 - Qualificacao Tecnica da Empresa",
  QUALIFICACAO_EQUIPE_TECNICA: "03 - Qualificacao da Equipe Tecnica",
  GARANTIA_CONTRATO: "04 - Garantia do Contrato",
};

// Sem acentos/caracteres especiais — evita problemas em descompactadores mais antigos.
// Prefixo numérico mantém a ordem da lei quando o explorador de arquivos lista em ordem
// alfabética.
export function nomePastaCategoria(categoria: HabilitacaoCategoria | null): string {
  return categoria ? NOME_PASTA[categoria] : "05 - Outros";
}
