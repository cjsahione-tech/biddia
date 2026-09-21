import type { HabilitacaoCategoria } from "@/lib/types";

// Documentos de habilitação recorrentes em licitações públicas brasileiras (Lei
// 14.133/2021) — mesmo vocabulário usado pelo dossiê da empresa (CompanyDocument.tipo)
// pra permitir casar um pelo outro por igualdade de string. Módulo client-safe (sem
// Prisma/IA) porque é importado tanto pelo Agente Secretário (servidor) quanto pela tela
// de Documentos (cliente), pro select de "tipo" do formulário usar a mesma lista.
export const CHECKLIST_BASE = [
  "Contrato Social / Estatuto consolidado",
  "Cartão CNPJ atualizado",
  "Certidão Negativa de Débitos Federais (Receita Federal/PGFN)",
  "Certidão Negativa de Débitos Estaduais",
  "Certidão Negativa de Débitos Municipais",
  "Certificado de Regularidade do FGTS (CRF)",
  "Certidão Negativa de Débitos Trabalhistas (CNDT)",
  "Balanço patrimonial / atestado de capacidade financeira",
  "Atestado(s) de Capacidade Técnica",
];

// Categoria fixa dos itens padrão acima — são os mesmos em toda licitação, não dependem
// do texto do edital, então não precisam passar pela IA de classificação.
export const CATEGORIA_BASE: Record<string, HabilitacaoCategoria> = {
  "Contrato Social / Estatuto consolidado": "FISCAL_TRABALHISTA_ECONOMICO_FINANCEIRA_JURIDICA",
  "Cartão CNPJ atualizado": "FISCAL_TRABALHISTA_ECONOMICO_FINANCEIRA_JURIDICA",
  "Certidão Negativa de Débitos Federais (Receita Federal/PGFN)": "FISCAL_TRABALHISTA_ECONOMICO_FINANCEIRA_JURIDICA",
  "Certidão Negativa de Débitos Estaduais": "FISCAL_TRABALHISTA_ECONOMICO_FINANCEIRA_JURIDICA",
  "Certidão Negativa de Débitos Municipais": "FISCAL_TRABALHISTA_ECONOMICO_FINANCEIRA_JURIDICA",
  "Certificado de Regularidade do FGTS (CRF)": "FISCAL_TRABALHISTA_ECONOMICO_FINANCEIRA_JURIDICA",
  "Certidão Negativa de Débitos Trabalhistas (CNDT)": "FISCAL_TRABALHISTA_ECONOMICO_FINANCEIRA_JURIDICA",
  "Balanço patrimonial / atestado de capacidade financeira": "FISCAL_TRABALHISTA_ECONOMICO_FINANCEIRA_JURIDICA",
  "Atestado(s) de Capacidade Técnica": "QUALIFICACAO_TECNICA_EMPRESA",
};
