import { describe, expect, it } from "vitest";
import { selecionarDocumentosPrincipais, type PncpArquivo } from "@/lib/agents/pncp";

const arq = (seq: number, titulo: string, tipo: number): PncpArquivo => ({
  sequencialDocumento: seq,
  titulo,
  url: `https://pncp/x/${seq}`,
  tipoDocumentoId: tipo,
  tipoDocumentoNome: "x",
  statusAtivo: true,
});

describe("seleção dos arquivos principais do PNCP", () => {
  it("CASO REAL: capa e edital de verdade, ambos do tipo Edital — registra os dois, com o edital primeiro", () => {
    const r = selecionarDocumentosPrincipais([arq(1, "Capa-Licitacao", 2), arq(2, "Edital---Republicacao---Exame-de-DNA.pdf", 2)]);
    expect(r.editais.map((e) => e.sequencialDocumento)).toEqual([2, 1]);
    expect(r.edital?.sequencialDocumento).toBe(2);
  });
  it("sem capa: mantém a ordem de publicação; no máximo 3", () => {
    const r = selecionarDocumentosPrincipais([arq(1, "Edital", 2), arq(2, "Edital retificado", 2), arq(3, "Aviso", 1), arq(4, "Outro edital", 2)]);
    expect(r.editais.map((e) => e.sequencialDocumento)).toEqual([1, 2, 3]);
  });
  it("os arquivos de edital não aparecem de novo entre os anexos de preços", () => {
    const r = selecionarDocumentosPrincipais([arq(1, "Edital", 2), arq(2, "Planilha de preços", 9), arq(3, "Termo de Referência", 4)]);
    expect(r.termoReferencia?.sequencialDocumento).toBe(3);
    expect(r.anexosPrecos.map((a) => a.sequencialDocumento)).toEqual([2]);
    expect(r.editais).toHaveLength(1);
  });
  it("sem nenhum arquivo de edital: nulo, sem erro", () => {
    const r = selecionarDocumentosPrincipais([arq(1, "Parecer", 12)]);
    expect(r.edital).toBeNull();
    expect(r.editais).toEqual([]);
  });
});
