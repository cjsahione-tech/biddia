import { describe, expect, it } from "vitest";
import {
  PASTA_DECLARACOES,
  PASTA_ECONOMICA,
  PASTA_EQUIPE,
  PASTA_FISCAL,
  PASTA_GARANTIA,
  PASTA_JURIDICA,
  PASTA_OUTROS,
  PASTA_TECNICA,
  PASTA_TRABALHISTA,
  pastaDoItemNoZip,
} from "@/lib/habilitacao-categorias";

const LARGA = "FISCAL_TRABALHISTA_ECONOMICO_FINANCEIRA_JURIDICA" as const;
const pasta = (documentoNome: string, categoria: Parameters<typeof pastaDoItemNoZip>[0]["categoria"] = LARGA, ehDeclaracaoGerada = false) =>
  pastaDoItemNoZip({ documentoNome, categoria, ehDeclaracaoGerada });

describe("pastas do ZIP de habilitação", () => {
  it("separa a categoria larga pelo assunto do documento", () => {
    expect(pasta("Contrato Social / Estatuto consolidado")).toBe(PASTA_JURIDICA);
    expect(pasta("Cartão CNPJ atualizado")).toBe(PASTA_JURIDICA);
    expect(pasta("Certidão Negativa de Débitos Federais (Receita Federal/PGFN)")).toBe(PASTA_FISCAL);
    expect(pasta("Certidão Negativa de Débitos Municipais")).toBe(PASTA_FISCAL);
    expect(pasta("Certificado de Regularidade do FGTS (CRF)")).toBe(PASTA_TRABALHISTA);
    expect(pasta("Certidão Negativa de Débitos Trabalhistas (CNDT)")).toBe(PASTA_TRABALHISTA);
    expect(pasta("Balanço patrimonial / atestado de capacidade financeira")).toBe(PASTA_ECONOMICA);
    expect(pasta("Certidão negativa de falência e recuperação judicial")).toBe(PASTA_ECONOMICA);
  });

  it("as outras categorias têm pasta própria", () => {
    expect(pasta("Atestado(s) de Capacidade Técnica", "QUALIFICACAO_TECNICA_EMPRESA")).toBe(PASTA_TECNICA);
    expect(pasta("Registro do responsável técnico", "QUALIFICACAO_EQUIPE_TECNICA")).toBe(PASTA_EQUIPE);
    expect(pasta("Seguro-garantia", "GARANTIA_CONTRATO")).toBe(PASTA_GARANTIA);
  });

  it("declarações vão para a pasta de declarações (geradas ou citadas pelo nome)", () => {
    expect(pasta("Anexo II – Declaração de Inexistência de Fato Impeditivo", null, true)).toBe(PASTA_DECLARACOES);
    expect(pasta("Declaração de que não emprega menor")).toBe(PASTA_DECLARACOES);
  });

  it("sem como saber, vai para Outros (nunca some do ZIP)", () => {
    expect(pasta("Documento qualquer", null)).toBe(PASTA_OUTROS);
    expect(pasta("Documento qualquer")).toBe(PASTA_OUTROS);
  });

  it("os nomes são numerados na ordem da lei e sem acento", () => {
    for (const p of [PASTA_JURIDICA, PASTA_FISCAL, PASTA_TRABALHISTA, PASTA_ECONOMICA, PASTA_TECNICA, PASTA_EQUIPE, PASTA_GARANTIA, PASTA_DECLARACOES, PASTA_OUTROS]) {
      expect(p).toMatch(/^\d\d - [A-Za-z ]+/);
      expect(p).not.toMatch(/[^\x20-\x7e]/);
    }
  });
});
