import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { arquivosComProblemaDe, explicarArquivo } from "@/lib/habilitacao-relatorio";

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
