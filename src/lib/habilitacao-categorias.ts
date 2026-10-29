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

// ── Pastas do ZIP de habilitação ────────────────────────────────────────────
//
// O checklist guarda 4 categorias largas (a primeira junta jurídica, fiscal, trabalhista e econômico-financeira). Para
// quem monta a pasta de documentos, o ideal é uma pasta por assunto, com nome claro e numerada na ordem da Lei 14.133:
// as 4 categorias continuam valendo para o checklist; o ZIP só separa a primeira pelo assunto do documento.

export const PASTA_JURIDICA = "01 - Habilitacao Juridica";
export const PASTA_FISCAL = "02 - Regularidade Fiscal";
export const PASTA_TRABALHISTA = "03 - Regularidade Trabalhista";
export const PASTA_ECONOMICA = "04 - Qualificacao Economico-Financeira";
export const PASTA_TECNICA = "05 - Qualificacao Tecnica da Empresa";
export const PASTA_EQUIPE = "06 - Qualificacao da Equipe Tecnica";
export const PASTA_GARANTIA = "07 - Garantia do Contrato";
export const PASTA_DECLARACOES = "08 - Declaracoes e Anexos do Edital";
export const PASTA_OUTROS = "09 - Outros";

const sem = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/**
 * Pasta do ZIP para um item do checklist. Declarações geradas pela plataforma vão para a pasta própria; itens da
 * categoria larga (fiscal/trabalhista/econômico-financeira/jurídica) são separados pelo assunto do nome do documento;
 * as demais categorias têm pasta própria. Sem como saber, vai para "Outros" — nunca some do ZIP.
 */
export function pastaDoItemNoZip(item: { documentoNome: string; categoria: HabilitacaoCategoria | null; ehDeclaracaoGerada?: boolean }): string {
  if (item.ehDeclaracaoGerada) return PASTA_DECLARACOES;
  if (item.categoria === "QUALIFICACAO_TECNICA_EMPRESA") return PASTA_TECNICA;
  if (item.categoria === "QUALIFICACAO_EQUIPE_TECNICA") return PASTA_EQUIPE;
  if (item.categoria === "GARANTIA_CONTRATO") return PASTA_GARANTIA;

  const nome = sem(item.documentoNome);
  if (/declara[cç]/.test(nome)) return PASTA_DECLARACOES;
  if (/balan[cç]o|indice|liquidez|patrimonio|capital social|falencia|recupera[cç]ao judicial|demonstra[cç]/.test(nome)) return PASTA_ECONOMICA;
  if (/trabalhist|cndt|fgts|\bcrf\b|menor|empregad/.test(nome)) return PASTA_TRABALHISTA;
  if (/certidao|tributo|fazenda|receita|pgfn|icms|\biss|municipal|estadual|federal|inscri[cç]|debito|regularidade fiscal/.test(nome)) return PASTA_FISCAL;
  if (/contrato social|estatuto|cnpj|registro|ato constitutivo|junta comercial|procura|identidade|\brg\b|\bcpf\b|elei[cç]ao|administrador|alteracao contratual/.test(nome)) return PASTA_JURIDICA;
  // Não bateu com nenhum assunto: fica em "Outros", para o usuário conferir.
  return PASTA_OUTROS;
}
