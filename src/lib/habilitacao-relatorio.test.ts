import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { arquivosComProblemaDe, explicarArquivo, linhasDeDocumentos, resumoDeLeitura, seloDoDocumento } from "@/lib/habilitacao-relatorio";

describe("arquivos com problema no relatório", () => {
  it("principais vêm primeiro; registros antigos (sem 'principal') contam como principais", () => {
    const r = arquivosComProblemaDe([
      { nome: "apoio.pdf", caracteres: 0, ok: false, principal: false, motivo: "formato" },
      { nome: "antigo.pdf", caracteres: 0, ok: false, motivo: "download" },
      { nome: "lido.pdf", caracteres: 10, ok: true, principal: true },
    ]);
    expect(r.map((a) => [a.nome, a.principal])).toEqual([["antigo.pdf", true], ["apoio.pdf", false]]);
  });
  it("leitura parcial diz quais partes ficaram de fora", () => {
    const e = explicarArquivo("Edital.pdf", "parcial", "páginas 61-100 não lidas (acima do limite de leitura por imagem)");
    expect(e.problema).toContain("páginas 61-100");
    expect(e.oQueFazer).toMatch(/manualmente/);
  });
  it("armazenamento e OCR em andamento não pedem nenhuma ação do usuário", () => {
    expect(explicarArquivo("a.pdf", "armazenamento").oQueFazer).toMatch(/Não precisa fazer nada/);
    expect(explicarArquivo("a.pdf", "ocr").oQueFazer).toMatch(/Não precisa fazer nada/);
  });
});

describe("quadro 'Documentos analisados'", () => {
  const docs = [
    { nome: "apoio-ok.pdf", caracteres: 100, ok: true, principal: false },
    { nome: "Edital.pdf", caracteres: 5000, ok: false, principal: true, motivo: "parcial", detalhe: "páginas 61-100 não lidas (acima do limite de leitura por imagem)" },
    { nome: "TR.pdf", caracteres: 900, ok: true, principal: true },
    { nome: "Planilha.xlsx", caracteres: 0, ok: false, principal: true, motivo: "armazenamento" },
    { nome: "Escaneado.pdf", caracteres: 0, ok: false, principal: true, motivo: "ocr" },
    { nome: "Modelo.pdf", caracteres: 0, ok: false, principal: false, motivo: "formato" },
  ];

  it("cada situação tem seu selo", () => {
    expect(seloDoDocumento({ ok: true })).toBe("LIDO");
    expect(seloDoDocumento({ ok: false, motivo: "parcial" })).toBe("PARCIAL");
    expect(seloDoDocumento({ ok: false, motivo: "ocr" })).toBe("LENDO");
    expect(seloDoDocumento({ ok: false, motivo: "armazenamento" })).toBe("AGUARDANDO");
    expect(seloDoDocumento({ ok: false, motivo: "download" })).toBe("NAO_LIDO");
    expect(seloDoDocumento({ ok: false })).toBe("NAO_LIDO");
  });

  it("principais primeiro e, em cada grupo, os com problema primeiro; lido por inteiro não tem 'problema'", () => {
    const l = linhasDeDocumentos(docs);
    expect(l.map((x) => x.nome)).toEqual(["Edital.pdf", "Planilha.xlsx", "Escaneado.pdf", "TR.pdf", "Modelo.pdf", "apoio-ok.pdf"]);
    expect(l.find((x) => x.nome === "TR.pdf")).toMatchObject({ selo: "LIDO", problema: null, oQueFazer: null, rotulo: "Lido por inteiro" });
    expect(l.find((x) => x.nome === "Edital.pdf")!.problema).toContain("páginas 61-100");
    expect(l.find((x) => x.nome === "Modelo.pdf")).toMatchObject({ papel: "apoio", selo: "NAO_LIDO" });
  });

  it("registro antigo (sem 'principal') aparece como principal", () => {
    expect(linhasDeDocumentos([{ nome: "velho.pdf", caracteres: 1, ok: true }])[0].papel).toBe("principal");
  });

  it("resumo em frase simples", () => {
    const r = resumoDeLeitura(linhasDeDocumentos(docs));
    expect(r).toMatchObject({ total: 6, lidos: 2, principais: 4, principaisLidos: 1 });
    expect(r.texto).toBe("2 de 6 documento(s) lido(s) por inteiro (principais: 1 de 4)");
    expect(resumoDeLeitura([]).texto).toMatch(/Nenhum documento/);
  });
});
