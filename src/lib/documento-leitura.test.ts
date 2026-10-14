import { describe, expect, it } from "vitest";
import {
  avisoDeCnpj,
  cnpjValido,
  extrairCnpjs,
  extrairEmissao,
  extrairValidade,
  sugerirItemDoDocumento,
} from "@/lib/documento-leitura";
import { escolherMelhorDocumento } from "@/lib/documentos-empresa";
import { ehPastaValida, itemAceitaVarios, pastaDoDocumento } from "@/lib/catalogo-documentos";

describe("sugestão do item pelo nome e pelo conteúdo", () => {
  it("reconhece certidões pelo conteúdo, sem confundir FGTS com federal", () => {
    expect(sugerirItemDoDocumento("scan001.pdf", "CERTIFICADO DE REGULARIDADE DO FGTS - CRF")?.chave).toBe("trabalhista-crf-fgts");
    expect(sugerirItemDoDocumento("x.pdf", "Certidão Negativa de Débitos Relativos aos Tributos Federais e à Dívida Ativa da União")?.chave).toBe("fiscal-federal");
    expect(sugerirItemDoDocumento("x.pdf", "CERTIDÃO NEGATIVA DE DÉBITOS TRABALHISTAS (CNDT) Tribunal Superior do Trabalho")?.chave).toBe("trabalhista-cndt");
    expect(sugerirItemDoDocumento("x.pdf", "Comprovante de Inscrição e de Situação Cadastral")?.chave).toBe("juridica-cartao-cnpj");
  });
  it("conteúdo vale mais que o nome; só nome = confiança média", () => {
    const porTexto = sugerirItemDoDocumento("cnd.pdf", "Certificado de Regularidade do FGTS");
    expect(porTexto?.chave).toBe("trabalhista-crf-fgts");
    expect(porTexto?.confianca).toBe("alta");
    const porNome = sugerirItemDoDocumento("CNDT_2026.pdf", null);
    expect(porNome?.chave).toBe("trabalhista-cndt");
    expect(porNome?.confianca).toBe("media");
  });
  it("sem pista nenhuma, não chuta", () => {
    expect(sugerirItemDoDocumento("IMG_2931.jpg", null)).toBeNull();
    expect(sugerirItemDoDocumento("documento.pdf", "texto qualquer sem nada de licitação")).toBeNull();
  });
});

describe("datas escritas no documento", () => {
  it("validade simples e período (vale a última data)", () => {
    expect(extrairValidade("Certidão emitida em 10/09/2026. Válida até 09/03/2027.")).toBe("2027-03-09");
    expect(extrairValidade("Validade: 01/10/2026 a 30/10/2026")).toBe("2026-10-30");
  });
  it("não inventa: sem validade ou data impossível = null", () => {
    expect(extrairValidade("Contrato social consolidado")).toBeNull();
    expect(extrairValidade("Validade 31/02/2026")).toBeNull();
  });
  it("emissão", () => {
    expect(extrairEmissao("Data de emissão: 15/08/2026")).toBe("2026-08-15");
    expect(extrairEmissao("sem data")).toBeNull();
  });
});

describe("CNPJ do documento", () => {
  const empresa = "11.222.333/0001-81"; // dígitos verificadores válidos
  it("valida os dígitos verificadores", () => {
    expect(cnpjValido("11.222.333/0001-81")).toBe(true);
    expect(cnpjValido("11.222.333/0001-82")).toBe(false);
    expect(cnpjValido("00000000000000")).toBe(false);
  });
  it("só considera números que são CNPJ de verdade", () => {
    expect(extrairCnpjs("CNPJ 11.222.333/0001-81 e protocolo 12.345.678/0001-00")).toEqual(["11222333000181"]);
  });
  it("documento de outra empresa gera aviso; da própria empresa não", () => {
    const outra = extrairCnpjs("CNPJ: 45.723.174/0001-10");
    expect(outra).toEqual(["45723174000110"]);
    expect(avisoDeCnpj(outra, empresa, "fiscal-federal")).toMatch(/não é o da empresa/);
    expect(avisoDeCnpj(["11222333000181"], empresa, "fiscal-federal")).toBeNull();
  });
  it("outra filial da mesma raiz é aviso mais leve", () => {
    expect(avisoDeCnpj(["11222333000262"], empresa, "fiscal-federal")).toMatch(/outro estabelecimento/);
  });
  it("atestados e certificados (emitidos por terceiros) nunca geram aviso", () => {
    expect(avisoDeCnpj(["45723174000110"], empresa, "atestados-fornecimento")).toBeNull();
    expect(avisoDeCnpj(["45723174000110"], empresa, "certificados-iso")).toBeNull();
  });
  it("sem CNPJ legível no arquivo não há o que avisar", () => {
    expect(avisoDeCnpj([], empresa, "fiscal-federal")).toBeNull();
  });
});

describe("pastas e vários documentos por item", () => {
  it("atestados, certificados e equipe aceitam vários; certidão não", () => {
    expect(itemAceitaVarios("atestados-fornecimento")).toBe(true);
    expect(itemAceitaVarios("certificados-iso")).toBe(true);
    expect(itemAceitaVarios("juridica-docs-socios")).toBe(true);
    expect(itemAceitaVarios("fiscal-federal")).toBe(false);
    expect(itemAceitaVarios("juridica-contrato-social")).toBe(false);
  });
  it("a pasta vem do item; documento personalizado usa a pasta escolhida; inválida = Outros", () => {
    expect(pastaDoDocumento({ catalogoChave: "fiscal-federal", tipo: "x" })).toBe("fiscal");
    expect(pastaDoDocumento({ catalogoChave: null, tipo: "Alvará", pasta: "tecnica_empresa" })).toBe("tecnica_empresa");
    expect(pastaDoDocumento({ catalogoChave: null, tipo: "Alvará", pasta: "inexistente" })).toBeNull();
    expect(pastaDoDocumento({ catalogoChave: null, tipo: "Alvará", pasta: null })).toBeNull();
    expect(ehPastaValida("fiscal")).toBe(true);
    expect(ehPastaValida("../etc")).toBe(false);
  });
});

describe("qual documento usar quando há vários do mesmo item", () => {
  const d = (id: string, validade: string | null, criado: string) => ({ id, validade: validade ? new Date(validade) : null, createdAt: new Date(criado) });
  const sessao = new Date("2026-11-10T00:00:00Z");
  it("prefere o válido na data da sessão, mesmo que seja mais antigo", () => {
    const vencido = d("novo-vencido", "2026-11-11", "2026-10-10"); // vence 1 dia depois: sem margem de 5 dias úteis
    const valido = d("antigo-valido", "2027-05-01", "2026-01-01");
    expect(escolherMelhorDocumento([vencido, valido], sessao)?.id).toBe("antigo-valido");
  });
  it("entre vários válidos, o mais recente", () => {
    expect(escolherMelhorDocumento([d("a", null, "2026-01-01"), d("b", null, "2026-06-01")], sessao)?.id).toBe("b");
  });
  it("se todos vencidos, o mais recente (a conferência marca como vencido)", () => {
    expect(escolherMelhorDocumento([d("a", "2026-01-01", "2025-01-01"), d("b", "2026-02-01", "2025-06-01")], sessao)?.id).toBe("b");
  });
  it("sem documentos = null", () => {
    expect(escolherMelhorDocumento([], sessao)).toBeNull();
  });
});
