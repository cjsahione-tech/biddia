import type { HabilitacaoCategoria } from "@/lib/types";

// Catálogo FIXO de documentos de habilitação da tela "Documentos" — igual para todas as
// empresas, sem precisar cadastrar. Os textos são descrição informativa; o sistema não
// inventa exigência legal além do que está aqui. Todo documento é OPCIONAL: a empresa só
// envia o que tem. Módulo client-safe (sem Prisma/IA): usado pela tela, pela API e pelo
// Agente Auditor.
//
// Aplicação: "P" = venda de produtos, "S" = prestação de serviços, "PS" = ambos.

export type Aplicacao = "P" | "S" | "PS";

export type CategoriaCatalogo =
  | "juridica"
  | "fiscal"
  | "trabalhista"
  | "economica"
  | "tecnica_empresa"
  | "equipe"
  | "certificados"
  | "atestados";

export type ItemCatalogo = {
  chave: string;
  categoria: CategoriaCatalogo;
  nome: string;
  aplicacao: Aplicacao;
  /** Detalhe informativo entre parênteses da lista original. */
  descricao?: string;
  /** Nota informativa sobre limites da lei — NUNCA vira bloqueio automático. */
  nota?: string;
  /** true = costuma ter data de validade (certidões, licenças) — só marca a caixinha por padrão. */
  vence?: boolean;
  /** Categoria de habilitação antiga (4 valores) usada pelo checklist/ZIP — mantém tudo funcionando. */
  categoriaLegada?: HabilitacaoCategoria;
  /** Nome do tipo usado ANTES do catálogo existir (dossiê antigo e Agente Secretário). */
  tipoLegado?: string;
  /** Outros nomes de tipo que reconhecemos como sendo este item (comparação sem acento/maiúscula). */
  aliases?: string[];
};

export type GrupoCatalogo = {
  id: CategoriaCatalogo;
  titulo: string;
  base?: string; // artigo da Lei 14.133/2021
  nota?: string;
};

export const CATEGORIAS_CATALOGO: GrupoCatalogo[] = [
  { id: "juridica", titulo: "Habilitação Jurídica", base: "Lei 14.133, art. 66" },
  { id: "fiscal", titulo: "Regularidade Fiscal", base: "art. 68" },
  { id: "trabalhista", titulo: "Regularidade Trabalhista", base: "art. 68, V e VI" },
  { id: "economica", titulo: "Qualificação Econômico-Financeira", base: "art. 69" },
  { id: "tecnica_empresa", titulo: "Qualificação Técnica da Empresa", base: "art. 67, I e II" },
  { id: "equipe", titulo: "Qualificação da Equipe Técnica", base: "art. 67, I e III" },
  { id: "certificados", titulo: "Certificados (conformidade, qualidade e produto)" },
  {
    id: "atestados",
    titulo: "Atestados de Capacidade Técnica",
    base: "art. 67, §1º ao §3º",
    nota: "A lei limita certas exigências — por exemplo, atestado de fornecimento até 50% da quantidade licitada e vedação de quantitativos mínimos para capacidade técnico-profissional. É só uma informação: o sistema não bloqueia nada por causa disso.",
  },
];

const FISCAL_TRAB_ECON_JUR: HabilitacaoCategoria = "FISCAL_TRABALHISTA_ECONOMICO_FINANCEIRA_JURIDICA";

export const CATALOGO_DOCUMENTOS: ItemCatalogo[] = [
  // 1. Habilitação Jurídica (art. 66)
  {
    chave: "juridica-contrato-social",
    categoria: "juridica",
    nome: "Contrato Social consolidado (ou Estatuto + ata de eleição da diretoria)",
    aplicacao: "PS",
    descricao: "Registrado na Junta Comercial ou Cartório.",
    categoriaLegada: FISCAL_TRAB_ECON_JUR,
    tipoLegado: "Contrato Social / Estatuto consolidado",
    aliases: ["Contrato Social"],
  },
  {
    chave: "juridica-cartao-cnpj",
    categoria: "juridica",
    nome: "Cartão CNPJ",
    aplicacao: "PS",
    descricao: "Situação ativa, CNAE compatível.",
    categoriaLegada: FISCAL_TRAB_ECON_JUR,
    tipoLegado: "Cartão CNPJ atualizado",
    aliases: ["Cartão CNPJ"],
    vence: true,
  },
  {
    chave: "juridica-docs-socios",
    categoria: "juridica",
    nome: "RG/CNH e CPF dos sócios administradores ou procurador",
    aplicacao: "PS",
    categoriaLegada: FISCAL_TRAB_ECON_JUR,
  },
  {
    chave: "juridica-decreto-autorizacao",
    categoria: "juridica",
    nome: "Decreto de autorização",
    aplicacao: "PS",
    descricao: "Empresa estrangeira em funcionamento no país.",
    categoriaLegada: FISCAL_TRAB_ECON_JUR,
  },
  {
    chave: "juridica-registro-entidade-classe",
    categoria: "juridica",
    nome: "Registro/inscrição na entidade de classe (CRA, CREA, CRBio, CRF, OAB)",
    aplicacao: "S",
    categoriaLegada: "QUALIFICACAO_TECNICA_EMPRESA",
    vence: true,
  },
  {
    chave: "juridica-procuracao",
    categoria: "juridica",
    nome: "Procuração com poderes expressos para contratos administrativos",
    aplicacao: "S",
    categoriaLegada: FISCAL_TRAB_ECON_JUR,
    vence: true,
  },

  // 2. Regularidade Fiscal (art. 68)
  {
    chave: "fiscal-federal",
    categoria: "fiscal",
    nome: "Certidão Conjunta Negativa (ou Positiva com Efeitos de Negativa) de Tributos Federais e Dívida Ativa da União",
    aplicacao: "PS",
    categoriaLegada: FISCAL_TRAB_ECON_JUR,
    tipoLegado: "Certidão Negativa de Débitos Federais (Receita Federal/PGFN)",
    aliases: ["Certidão Negativa de Débitos Federais"],
    vence: true,
  },
  {
    chave: "fiscal-estadual-icms",
    categoria: "fiscal",
    nome: "Certidão Negativa de Tributos Estaduais/ICMS",
    aplicacao: "P",
    categoriaLegada: FISCAL_TRAB_ECON_JUR,
    tipoLegado: "Certidão Negativa de Débitos Estaduais",
    vence: true,
  },
  {
    chave: "fiscal-estadual-servicos",
    categoria: "fiscal",
    nome: "Certidão Negativa Estadual (ou declaração de isenção/não inscrição)",
    aplicacao: "S",
    categoriaLegada: FISCAL_TRAB_ECON_JUR,
    vence: true,
  },
  {
    chave: "fiscal-municipal",
    categoria: "fiscal",
    nome: "Certidão Negativa de Tributos Municipais/Mobiliários",
    aplicacao: "P",
    categoriaLegada: FISCAL_TRAB_ECON_JUR,
    tipoLegado: "Certidão Negativa de Débitos Municipais",
    vence: true,
  },
  {
    chave: "fiscal-issqn",
    categoria: "fiscal",
    nome: "Certidão Negativa de Tributos Mobiliários/ISSQN",
    aplicacao: "S",
    categoriaLegada: FISCAL_TRAB_ECON_JUR,
    vence: true,
  },

  // 3. Regularidade Trabalhista (art. 68, V e VI) — todos [P+S]
  {
    chave: "trabalhista-cndt",
    categoria: "trabalhista",
    nome: "CNDT (Certidão Negativa de Débitos Trabalhistas)",
    aplicacao: "PS",
    categoriaLegada: FISCAL_TRAB_ECON_JUR,
    tipoLegado: "Certidão Negativa de Débitos Trabalhistas (CNDT)",
    aliases: ["Certidão Negativa de Débitos Trabalhistas", "CNDT"],
    vence: true,
  },
  {
    chave: "trabalhista-crf-fgts",
    categoria: "trabalhista",
    nome: "CRF/FGTS (Caixa)",
    aplicacao: "PS",
    categoriaLegada: FISCAL_TRAB_ECON_JUR,
    tipoLegado: "Certificado de Regularidade do FGTS (CRF)",
    aliases: ["Certificado de Regularidade do FGTS", "CRF FGTS"],
    vence: true,
  },
  {
    chave: "trabalhista-decl-menores",
    categoria: "trabalhista",
    nome: "Declaração de cumprimento do art. 7º, XXXIII, da CF/88 (menores de 18/16 anos)",
    aplicacao: "PS",
    categoriaLegada: FISCAL_TRAB_ECON_JUR,
  },
  {
    chave: "trabalhista-decl-fato-impeditivo",
    categoria: "trabalhista",
    nome: "Declaração de inexistência de fato impeditivo",
    aplicacao: "PS",
    categoriaLegada: FISCAL_TRAB_ECON_JUR,
  },
  {
    chave: "trabalhista-decl-cotas",
    categoria: "trabalhista",
    nome: "Declaração de cota de aprendizagem (art. 429 CLT) e de pessoas com deficiência (art. 93 da Lei 8.213/91)",
    aplicacao: "PS",
    categoriaLegada: FISCAL_TRAB_ECON_JUR,
  },

  // 4. Qualificação Econômico-Financeira (art. 69)
  {
    chave: "economica-balanco-dre",
    categoria: "economica",
    nome: "Balanço Patrimonial e DRE do último exercício",
    aplicacao: "PS",
    descricao: "Assinados por contador e registrados (ECD/SPED ou Junta).",
    categoriaLegada: FISCAL_TRAB_ECON_JUR,
    tipoLegado: "Balanço patrimonial / atestado de capacidade financeira",
    aliases: ["Balanço Patrimonial"],
  },
  {
    chave: "economica-indices",
    categoria: "economica",
    nome: "Índices de liquidez e solvência",
    aplicacao: "PS",
    descricao: "LG, LC e SG maiores que 1,00.",
    categoriaLegada: FISCAL_TRAB_ECON_JUR,
    aliases: ["Índices financeiros"],
  },
  {
    chave: "economica-falencia",
    categoria: "economica",
    nome: "Certidão Negativa de Falência e Recuperação Judicial (ou plano homologado)",
    aplicacao: "PS",
    categoriaLegada: FISCAL_TRAB_ECON_JUR,
    aliases: ["Certidão Negativa de Falência"],
    vence: true,
  },
  {
    chave: "economica-patrimonio-liquido",
    categoria: "economica",
    nome: "Comprovação de Patrimônio Líquido ou Capital Social mínimo",
    aplicacao: "S",
    descricao: "Até 10% do valor estimado.",
    categoriaLegada: FISCAL_TRAB_ECON_JUR,
  },
  {
    chave: "economica-capital-giro",
    categoria: "economica",
    nome: "Capital de giro / Índice de Endividamento Geral",
    aplicacao: "S",
    categoriaLegada: FISCAL_TRAB_ECON_JUR,
  },
  {
    chave: "economica-garantia-proposta",
    categoria: "economica",
    nome: "Garantia de proposta",
    aplicacao: "PS",
    descricao: "Quando prevista no edital.",
    categoriaLegada: "GARANTIA_CONTRATO",
    vence: true,
  },

  // 5. Qualificação Técnica da Empresa (art. 67, I e II)
  {
    chave: "tecnica-registro-orgao-setorial",
    categoria: "tecnica_empresa",
    nome: "Registro no órgão regulador setorial (ANVISA, MAPA, INMETRO etc.)",
    aplicacao: "P",
    categoriaLegada: "QUALIFICACAO_TECNICA_EMPRESA",
    vence: true,
  },
  {
    chave: "tecnica-licenca-sanitaria",
    categoria: "tecnica_empresa",
    nome: "Licença Sanitária ou Autorização de Funcionamento (AFE/AE)",
    aplicacao: "P",
    categoriaLegada: "QUALIFICACAO_TECNICA_EMPRESA",
    aliases: ["Vigilância Sanitária"],
    vence: true,
  },
  {
    chave: "tecnica-estrutura-fisica",
    categoria: "tecnica_empresa",
    nome: "Comprovação de estrutura física",
    aplicacao: "P",
    descricao: "Armazenamento, transporte refrigerado.",
    categoriaLegada: "QUALIFICACAO_TECNICA_EMPRESA",
  },
  {
    chave: "tecnica-crq-conselho",
    categoria: "tecnica_empresa",
    nome: "Certidão de Registro e Quitação da Pessoa Jurídica no conselho (CREA, CRA, CRB, CRF etc.)",
    aplicacao: "S",
    categoriaLegada: "QUALIFICACAO_TECNICA_EMPRESA",
    vence: true,
  },
  {
    chave: "tecnica-licencas-ambientais",
    categoria: "tecnica_empresa",
    nome: "Licenças ambientais, alvarás sanitários ou autorizações especiais",
    aplicacao: "S",
    descricao: "Ex.: Polícia Federal, ANVISA.",
    categoriaLegada: "QUALIFICACAO_TECNICA_EMPRESA",
    aliases: ["Alvará de Licença"],
    vence: true,
  },
  {
    chave: "tecnica-vistoria",
    categoria: "tecnica_empresa",
    nome: "Declaração de vistoria técnica ou de conhecimento das condições locais",
    aplicacao: "S",
    categoriaLegada: "QUALIFICACAO_TECNICA_EMPRESA",
  },

  // 6. Qualificação da Equipe Técnica (art. 67, I e III)
  {
    chave: "equipe-responsavel-tecnico",
    categoria: "equipe",
    nome: "Responsável Técnico habilitado e registrado no conselho",
    aplicacao: "P",
    descricao: "Quando exigido.",
    categoriaLegada: "QUALIFICACAO_EQUIPE_TECNICA",
    vence: true,
  },
  {
    chave: "equipe-vinculo",
    categoria: "equipe",
    nome: "Comprovação de vínculo profissional",
    aplicacao: "S",
    descricao: "CTPS, contrato de prestação de serviços ou condição de sócio/diretor.",
    categoriaLegada: "QUALIFICACAO_EQUIPE_TECNICA",
  },
  {
    chave: "equipe-quitacao-profissional",
    categoria: "equipe",
    nome: "Certidão de quitação e regularidade do profissional no conselho regional",
    aplicacao: "S",
    categoriaLegada: "QUALIFICACAO_EQUIPE_TECNICA",
    vence: true,
  },
  {
    chave: "equipe-termo-anuencia",
    categoria: "equipe",
    nome: "Termo de anuência/declaração de disponibilidade do responsável técnico",
    aplicacao: "S",
    categoriaLegada: "QUALIFICACAO_EQUIPE_TECNICA",
  },

  // 7. Certificados (conformidade, qualidade e produto)
  {
    chave: "certificados-registro-produto",
    categoria: "certificados",
    nome: "Registro ou notificação do produto (ANVISA, ANATEL, INMETRO)",
    aplicacao: "P",
    categoriaLegada: "QUALIFICACAO_TECNICA_EMPRESA",
    vence: true,
  },
  {
    chave: "certificados-boas-praticas",
    categoria: "certificados",
    nome: "Certificado de Boas Práticas (CBPF ou CBPDA)",
    aplicacao: "P",
    categoriaLegada: "QUALIFICACAO_TECNICA_EMPRESA",
    vence: true,
  },
  {
    chave: "certificados-laudos-ensaios",
    categoria: "certificados",
    nome: "Laudos e ensaios acreditados (INMETRO/RBC) atestando conformidade com a norma NBR",
    aplicacao: "P",
    categoriaLegada: "QUALIFICACAO_TECNICA_EMPRESA",
  },
  {
    chave: "certificados-procedencia-fabricante",
    categoria: "certificados",
    nome: "Declaração de procedência e Carta de Solidariedade do fabricante",
    aplicacao: "P",
    categoriaLegada: "QUALIFICACAO_TECNICA_EMPRESA",
  },
  {
    chave: "certificados-iso",
    categoria: "certificados",
    nome: "ISO 9001, ISO 14001, ISO 27001, ISO 45001",
    aplicacao: "S",
    categoriaLegada: "QUALIFICACAO_TECNICA_EMPRESA",
    vence: true,
  },
  {
    chave: "certificados-calibracao",
    categoria: "certificados",
    nome: "Certificados de calibração e rastreabilidade RBC dos equipamentos",
    aplicacao: "S",
    categoriaLegada: "QUALIFICACAO_TECNICA_EMPRESA",
    vence: true,
  },
  {
    chave: "certificados-nr",
    categoria: "certificados",
    nome: "Certificados de capacitação por NR (NR-10, NR-35, NR-33 etc.) da equipe de campo",
    aplicacao: "S",
    categoriaLegada: "QUALIFICACAO_EQUIPE_TECNICA",
    vence: true,
  },

  // 8. Atestados de Capacidade Técnica (art. 67, §1º ao §3º)
  {
    chave: "atestados-fornecimento",
    categoria: "atestados",
    nome: "Atestado de Fornecimento em nome da empresa",
    aplicacao: "P",
    nota: "A lei limita a exigência de atestado de fornecimento a até 50% da quantidade licitada.",
    categoriaLegada: "QUALIFICACAO_TECNICA_EMPRESA",
    tipoLegado: "Atestado(s) de Capacidade Técnica",
  },
  {
    chave: "atestados-notas-contratos",
    categoria: "atestados",
    nome: "Notas fiscais, contratos ou ordens de fornecimento que comprovem o atestado",
    aplicacao: "P",
    categoriaLegada: "QUALIFICACAO_TECNICA_EMPRESA",
  },
  {
    chave: "atestados-tecnico-operacional",
    categoria: "atestados",
    nome: "Atestado Técnico-Operacional (da empresa)",
    aplicacao: "S",
    categoriaLegada: "QUALIFICACAO_TECNICA_EMPRESA",
  },
  {
    chave: "atestados-tecnico-profissional",
    categoria: "atestados",
    nome: "Atestado Técnico-Profissional (da equipe) com Certidão de Acervo Técnico (CAT) ou equivalente",
    aplicacao: "S",
    nota: "A lei veda a exigência de quantitativos mínimos para a capacidade técnico-profissional.",
    categoriaLegada: "QUALIFICACAO_EQUIPE_TECNICA",
  },
];

const POR_CHAVE = new Map(CATALOGO_DOCUMENTOS.map((i) => [i.chave, i]));

export function itemPorChave(chave: string | null | undefined): ItemCatalogo | undefined {
  return chave ? POR_CHAVE.get(chave) : undefined;
}

/** Sem acento, minúsculas, espaços e pontuação simples colapsados — para comparar nomes de tipo. */
export function normalizarNomeTipo(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const POR_NOME = (() => {
  const m = new Map<string, string>();
  for (const i of CATALOGO_DOCUMENTOS) {
    for (const nome of [i.nome, i.tipoLegado, ...(i.aliases ?? [])]) {
      if (nome && !m.has(normalizarNomeTipo(nome))) m.set(normalizarNomeTipo(nome), i.chave);
    }
  }
  return m;
})();

/**
 * A qual item do catálogo um documento do dossiê pertence: pela chave gravada ou, para
 * documentos antigos (enviados antes do catálogo), pelo nome do tipo — comparação exata sem
 * acento/maiúscula, nunca por "adivinhação". Sem correspondência: null (vai para "Outros").
 */
export function chaveEfetivaDoDocumento(doc: { catalogoChave?: string | null; tipo: string }): string | null {
  if (doc.catalogoChave && POR_CHAVE.has(doc.catalogoChave)) return doc.catalogoChave;
  return POR_NOME.get(normalizarNomeTipo(doc.tipo)) ?? null;
}

/**
 * Itens PADRÃO do checklist de cada edital (Agente Secretário) -> itens do catálogo que
 * podem preenchê-los. Os de produto e de serviço aceitam qualquer um dos dois.
 */
export const CHECKLIST_BASE_PARA_CATALOGO: Record<string, string[]> = {
  "Contrato Social / Estatuto consolidado": ["juridica-contrato-social"],
  "Cartão CNPJ atualizado": ["juridica-cartao-cnpj"],
  "Certidão Negativa de Débitos Federais (Receita Federal/PGFN)": ["fiscal-federal"],
  "Certidão Negativa de Débitos Estaduais": ["fiscal-estadual-icms", "fiscal-estadual-servicos"],
  "Certidão Negativa de Débitos Municipais": ["fiscal-municipal", "fiscal-issqn"],
  "Certificado de Regularidade do FGTS (CRF)": ["trabalhista-crf-fgts"],
  "Certidão Negativa de Débitos Trabalhistas (CNDT)": ["trabalhista-cndt"],
  "Balanço patrimonial / atestado de capacidade financeira": ["economica-balanco-dre"],
  "Atestado(s) de Capacidade Técnica": [
    "atestados-fornecimento",
    "atestados-tecnico-operacional",
    "atestados-tecnico-profissional",
  ],
};

export const ROTULO_APLICACAO: Record<Aplicacao, string> = { P: "Produtos", S: "Serviços", PS: "Produtos e serviços" };

export function itensDaCategoria(id: CategoriaCatalogo): ItemCatalogo[] {
  return CATALOGO_DOCUMENTOS.filter((i) => i.categoria === id);
}

/**
 * Itens que são, no mundo real, a mesma certidão em "versões" de produto e de serviço. Um
 * documento enviado numa versão pode servir à outra, mas a auditoria nunca assume isso sozinha:
 * marca como "verificar manualmente".
 */
export const EQUIVALENTES_CATALOGO: string[][] = [
  ["fiscal-estadual-icms", "fiscal-estadual-servicos"],
  ["fiscal-municipal", "fiscal-issqn"],
];

export function equivalentesDe(chave: string): string[] {
  const grupo = EQUIVALENTES_CATALOGO.find((g) => g.includes(chave));
  return grupo ? grupo.filter((c) => c !== chave) : [];
}
