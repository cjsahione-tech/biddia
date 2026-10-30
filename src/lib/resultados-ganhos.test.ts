import { describe, expect, it, vi } from "vitest";

// Só a parte pura de resultados.ts é testada aqui — o acesso ao banco não entra.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { FILTROS_PADRAO, montarResultados, type EditalParaResultados } from "@/lib/resultados";
import { ETAPA_LABEL, origemPedeConfirmacaoGanho } from "@/lib/kanban";

function edital(id: string, extra: Partial<EditalParaResultados> = {}): EditalParaResultados {
  return {
    id,
    titulo: `Pregão ${id}`,
    fonte: "PNCP",
    uf: "SP",
    orgaoNome: "Prefeitura",
    tipoObjeto: "BEM",
    etapaKanban: "OPORTUNIDADE",
    valorGlobal: 1000,
    orcamentoSigiloso: false,
    createdAt: "2026-09-01T10:00:00.000Z",
    decidedAt: null,
    proposalValor: null,
    ...extra,
  };
}

describe("Resultados com valor homologado", () => {
  it("usa o valor homologado nos ganhos e o de referência no resto", () => {
    const r = montarResultados(
      [
        edital("g1", { etapaKanban: "ACEITA", valorHomologado: 850 }),
        edital("g2", { etapaKanban: "EM_CONTRATO" }), // ganho ainda sem registro: vale o valor do edital
        edital("p1", { etapaKanban: "RECUSADA_DESCLASSIFICADA", valorHomologado: 5 }), // homologado de perdido é ignorado
        edital("a1", { etapaKanban: "ENVIADA_PARA_DISPUTA" }),
      ],
      FILTROS_PADRAO
    );
    expect(r.ganhos).toBe(2);
    expect(r.valorGanho).toBe(850 + 1000);
    expect(r.ticketMedioGanho).toBe((850 + 1000) / 2);
    expect(r.valorPerdido).toBe(1000);
    expect(r.valorEmDisputa).toBe(1000);
  });

  it("lista os ganhos com o desconto sobre a referência e conta os sem registro", () => {
    const r = montarResultados(
      [
        edital("g1", { etapaKanban: "ACEITA", valorHomologado: 850, decidedAt: "2026-09-10T10:00:00.000Z" }),
        edital("g2", { etapaKanban: "FINALIZADA", decidedAt: "2026-09-20T10:00:00.000Z" }),
        edital("a1", { etapaKanban: "CLASSIFICACAO" }),
      ],
      FILTROS_PADRAO
    );
    expect(r.ganhosDetalhe.map((g) => g.editalId)).toEqual(["g2", "g1"]); // o mais recente primeiro
    const g1 = r.ganhosDetalhe.find((g) => g.editalId === "g1")!;
    expect(g1).toMatchObject({ valorReferencia: 1000, valorHomologado: 850 });
    expect(g1.descontoPercentual).toBeCloseTo(15);
    const g2 = r.ganhosDetalhe.find((g) => g.editalId === "g2")!;
    expect(g2.valorHomologado).toBeNull();
    expect(g2.descontoPercentual).toBeNull();
    expect(r.qtdGanhosSemRegistro).toBe(1);
  });

  it("sem nenhum ganho a lista vem vazia", () => {
    const r = montarResultados([edital("a1")], FILTROS_PADRAO);
    expect(r.ganhosDetalhe).toEqual([]);
    expect(r.qtdGanhosSemRegistro).toBe(0);
  });
});

describe("Coluna Ganhas", () => {
  it("a etapa ACEITA aparece como Ganhas", () => {
    expect(ETAPA_LABEL.ACEITA).toBe("Ganhas");
  });

  it("pede confirmação extra só quando o card vem de uma coluna muito inicial ou de desfecho negativo", () => {
    expect(origemPedeConfirmacaoGanho("OPORTUNIDADE")).toBe(true);
    expect(origemPedeConfirmacaoGanho("QUALIFICACAO")).toBe(true);
    expect(origemPedeConfirmacaoGanho("PRONTA_PARA_ENVIAR")).toBe(true);
    expect(origemPedeConfirmacaoGanho("RECUSADA_DESCLASSIFICADA")).toBe(true);
    expect(origemPedeConfirmacaoGanho("RASCUNHO")).toBe(true);
    expect(origemPedeConfirmacaoGanho("ENVIADA_PARA_DISPUTA")).toBe(false);
    expect(origemPedeConfirmacaoGanho("CLASSIFICACAO")).toBe(false);
    expect(origemPedeConfirmacaoGanho("EM_CONTRATO")).toBe(false);
  });
});
