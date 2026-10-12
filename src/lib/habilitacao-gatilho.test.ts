import { describe, it, expect } from "vitest";
import { custoEstimadoBrl, etapaAudita, fingerprintEdital, LISTA_ETAPAS_QUE_AUDITAM } from "@/lib/habilitacao";

describe("etapaAudita — a auditoria só roda a partir de Qualificação", () => {
  it("audita em Qualificação e nas etapas seguintes", () => {
    for (const e of ["QUALIFICACAO", "PRONTA_PARA_ENVIAR", "ENVIADA_PARA_DISPUTA", "CLASSIFICACAO", "ACEITA", "EM_CONTRATO", "FINALIZADA"]) {
      expect(etapaAudita(e)).toBe(true);
    }
  });

  it("NÃO audita em Oportunidade, Rascunho nem nas etapas negativas", () => {
    for (const e of ["OPORTUNIDADE", "RASCUNHO", "SEM_PROPOSTAS", "ELIMINADA_APOS_CLASSIFICACAO", "RECUSADA_DESCLASSIFICADA"]) {
      expect(etapaAudita(e)).toBe(false);
    }
  });

  it("a lista usada nos filtros do banco é a mesma da função", () => {
    expect(LISTA_ETAPAS_QUE_AUDITAM).toHaveLength(7);
    expect(LISTA_ETAPAS_QUE_AUDITAM.every(etapaAudita)).toBe(true);
  });
});

describe("fingerprintEdital — decide se o resultado salvo ainda vale", () => {
  const docs = [
    { id: "b", nome: "Termo.pdf", origemUrl: "https://x/b" },
    { id: "a", nome: "Edital.pdf", origemUrl: "https://x/a" },
  ];
  const datas = { dataAberturaProposta: new Date("2026-11-10T13:00:00Z"), dataEncerramentoProposta: null };

  it("é estável: mesma entrada (em qualquer ordem) dá a mesma impressão digital", () => {
    expect(fingerprintEdital(docs, datas)).toBe(fingerprintEdital([...docs].reverse(), datas));
  });

  it("muda quando entra, sai ou é trocado um documento do edital", () => {
    const base = fingerprintEdital(docs, datas);
    expect(fingerprintEdital([...docs, { id: "c", nome: "Anexo.pdf", origemUrl: null }], datas)).not.toBe(base);
    expect(fingerprintEdital(docs.slice(1), datas)).not.toBe(base);
    expect(fingerprintEdital([{ ...docs[0], id: "novo" }, docs[1]], datas)).not.toBe(base);
  });

  it("muda quando a data da sessão muda (a validade dos documentos depende dela)", () => {
    const base = fingerprintEdital(docs, datas);
    expect(fingerprintEdital(docs, { ...datas, dataAberturaProposta: new Date("2026-12-01T13:00:00Z") })).not.toBe(base);
  });
});

describe("custoEstimadoBrl", () => {
  it("estimativa proporcional à quantidade de auditorias", () => {
    expect(custoEstimadoBrl(0)).toBe(0);
    expect(custoEstimadoBrl(13)).toBeCloseTo(13 * 0.15 * 5.5, 1);
  });
});

describe("agruparPorHabilitacao — coluna Qualificação separada pelo resultado", () => {
  const c = (id: string, habilitacaoStatus: string) => ({ id, habilitacaoStatus });
  it("agrupa por resultado, na ordem: em andamento, habilitadas, não habilitadas, problema, sem auditoria", async () => {
    const { agruparPorHabilitacao } = await import("@/lib/habilitacao");
    const g = agruparPorHabilitacao([
      c("1", "NAO_HABILITADA"), c("2", "HABILITADA"), c("3", "AUDITANDO"), c("4", "HABILITADA_RESSALVAS"),
      c("5", "ERRO"), c("6", "NA_FILA"), c("7", "AGUARDANDO"),
    ]);
    expect(g.map((x) => x.chave)).toEqual(["EM_AUDITORIA", "HABILITADAS", "NAO_HABILITADAS", "COM_PROBLEMA", "SEM_AUDITORIA"]);
    expect(g[0].cards.map((x) => x.id)).toEqual(["3", "6"]);
    expect(g[1].cards.map((x) => x.id)).toEqual(["2", "4"]); // com ressalvas fica nas Habilitadas
    expect(g.reduce((n, x) => n + x.cards.length, 0)).toBe(7); // nenhum card some
  });
  it("só devolve grupos com cards e nunca perde um estado desconhecido", async () => {
    const { agruparPorHabilitacao } = await import("@/lib/habilitacao");
    const g = agruparPorHabilitacao([c("1", "HABILITADA"), c("2", "ESTADO_NOVO")]);
    expect(g.map((x) => x.chave)).toEqual(["HABILITADAS", "SEM_AUDITORIA"]);
    expect(g[1].cards[0].id).toBe("2");
  });
  it("passaFiltroHabilitacao: selo exato ou grupo inteiro", async () => {
    const { passaFiltroHabilitacao } = await import("@/lib/habilitacao");
    expect(passaFiltroHabilitacao("HABILITADA_RESSALVAS", "grupo:HABILITADAS")).toBe(true);
    expect(passaFiltroHabilitacao("NAO_HABILITADA", "grupo:HABILITADAS")).toBe(false);
    expect(passaFiltroHabilitacao("ERRO", "ERRO")).toBe(true);
    expect(passaFiltroHabilitacao("ERRO", null)).toBe(true);
  });
});
