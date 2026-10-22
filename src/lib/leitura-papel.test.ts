import { describe, expect, it } from "vitest";
import { descreverNaoLido, papeisDosDocumentos, papelDoDocumento } from "@/lib/leitura-papel";

describe("papel do documento na leitura", () => {
  it("edital, termo de referência e anexo de preços são principais (pela categoria)", () => {
    for (const categoria of ["EDITAL", "TERMO_REFERENCIA", "ANEXO_PRECOS"]) {
      expect(papelDoDocumento({ nome: "x.pdf", tipo: "DOCUMENTO_PNCP", categoria })).toBe("principal");
    }
  });
  it("o que a empresa anexou (dossiê/checklist/correção) é apoio, mesmo com nome parecido", () => {
    expect(papelDoDocumento({ nome: "Certidão negativa.pdf", tipo: "DOCUMENTO_USUARIO", categoria: "CHECKLIST" })).toBe("apoio");
    expect(papelDoDocumento({ nome: "Proposta de preços.pdf", tipo: "DOCUMENTO_USUARIO", categoria: "CHECKLIST" })).toBe("apoio");
    expect(papelDoDocumento({ nome: "correcao.pdf", tipo: "DOCUMENTO_USUARIO", categoria: "CORRECAO_AGENTE" })).toBe("apoio");
  });
  it("sem categoria: planilhas, retificações e quantitativos são principais; modelos de declaração são apoio", () => {
    const sem = (nome: string) => papelDoDocumento({ nome, tipo: "DOCUMENTO_PNCP", categoria: null });
    expect(sem("Planilha de quantitativos.xlsx")).toBe("principal");
    expect(sem("Retificação 01 do edital.pdf")).toBe("principal");
    expect(sem("ERRATA.pdf")).toBe("principal");
    expect(sem("Orçamento estimado.pdf")).toBe("principal");
    expect(sem("Anexo III - Modelo de declaração.pdf")).toBe("apoio");
    expect(sem("Minuta do contrato.pdf")).toBe("apoio");
  });
  it("edital mandado à mão em 'Adicionar PDF' (sem categoria) conta como principal pelo nome", () => {
    expect(papelDoDocumento({ nome: "Edital Pregão 031.pdf", tipo: "DOCUMENTO_USUARIO", categoria: null })).toBe("principal");
  });
  it("se nada parece principal, todos viram principais (regra mais rígida na dúvida)", () => {
    const m = papeisDosDocumentos([
      { id: "1", nome: "arquivo1.pdf", tipo: "DOCUMENTO_PNCP", categoria: null },
      { id: "2", nome: "arquivo2.pdf", tipo: "DOCUMENTO_PNCP", categoria: null },
    ]);
    expect([...m.values()]).toEqual(["principal", "principal"]);
  });
  it("com pelo menos um principal, os outros continuam de apoio", () => {
    const m = papeisDosDocumentos([
      { id: "1", nome: "Edital.pdf", tipo: "DOCUMENTO_PNCP", categoria: "EDITAL" },
      { id: "2", nome: "Modelo de declaração.pdf", tipo: "DOCUMENTO_PNCP", categoria: null },
    ]);
    expect(m.get("1")).toBe("principal");
    expect(m.get("2")).toBe("apoio");
  });
});

describe("descreverNaoLido", () => {
  it("lê as marcas de páginas e de arquivos dentro de ZIP", () => {
    const texto = "texto\n[[ARQUIVO ILEGÍVEL: páginas 61-100 não lidas (acima do limite de leitura por imagem)]]\n[[ARQUIVO ILEGÍVEL: anexo.pdf]]";
    expect(descreverNaoLido(texto)).toEqual([
      "páginas 61-100 não lidas (acima do limite de leitura por imagem)",
      'arquivo "anexo.pdf" (dentro do pacote)',
    ]);
    expect(descreverNaoLido("sem marcas")).toEqual([]);
  });
});

describe("arquivo do portal trocado pelo analista", () => {
  it("o 'Edital' do portal que não abre vira apoio quando o analista enviou outro 'Edital' (não trava o resultado)", () => {
    const m = papeisDosDocumentos([
      { id: "portal", nome: "Edital.pdf", tipo: "DOCUMENTO_PNCP", categoria: "EDITAL" },
      { id: "tr", nome: "TR.pdf", tipo: "DOCUMENTO_PNCP", categoria: "TERMO_REFERENCIA" },
      { id: "meu", nome: "Edital sem senha.pdf", tipo: "DOCUMENTO_USUARIO", categoria: "EDITAL" },
    ]);
    expect(m.get("portal")).toBe("apoio");
    expect(m.get("meu")).toBe("principal");
    expect(m.get("tr")).toBe("principal"); // o TR não foi trocado
  });
  it("arquivo do analista sem categoria não troca nada", () => {
    const m = papeisDosDocumentos([
      { id: "portal", nome: "Edital.pdf", tipo: "DOCUMENTO_PNCP", categoria: "EDITAL" },
      { id: "extra", nome: "contrato assinado.pdf", tipo: "DOCUMENTO_USUARIO", categoria: null },
    ]);
    expect(m.get("portal")).toBe("principal");
  });
});
