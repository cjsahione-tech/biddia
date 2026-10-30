/* eslint-disable @typescript-eslint/no-explicit-any -- os mocks deste teste usam any de propósito (dados de mentira) */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { EstudoProdutoAba } from "@/components/estudo-viabilidade/aba/EstudoProdutoAba";
import type { PacoteAba, ItemEstudoAba } from "@/lib/estudo-aba-tipos";

const item = (over: Partial<ItemEstudoAba> = {}): ItemEstudoAba => ({
  itemIndex: 0, numero: 1, descricao: "Notebook Dell 14 polegadas", unidade: "un", quantidade: 10, lote: null,
  valorUnitarioReferencia: 200, valorTotalReferencia: 2000, valorReferenciaManual: false, itemGlobal: false,
  custos: { custoAquisicaoUnitario: 0, freteLogistica: 0, icmsStDifal: 0, fornecedor: "" }, fonteCusto: "VAZIO", sugestao: null, ...over,
});

function pacote(itens: ItemEstudoAba[], extra: Partial<PacoteAba["produto"]> = {}, estudoExtra: Record<string, unknown> = {}): PacoteAba {
  return {
    edital: { id: "e1", titulo: "Aviso", orgaoNome: "Prefeitura", valorGlobal: null, orcamentoSigiloso: false, tipoObjeto: "BEM" },
    ramoSugerido: "PRODUTO",
    empresa: { regimeTributarioPadrao: null, anexoSimplesPadrao: null, rbt12Padrao: null },
    estudo: { id: "s1", ramo: "PRODUTO", nome: null, createdAt: "", updatedAt: "", editalId: "e1", edital: null, requisitosJson: null, requisitosConfirmadoEm: null,
      regimeTributario: "SIMPLES_NACIONAL", anexoSimples: "I", rbt12: 500000, aliquotasJson: null, tributosConfirmadoEm: "2026-10-01T00:00:00Z",
      custosConfirmadoEm: null, margemMinimaAceitavel: null, calculoConfirmadoEm: null, ...estudoExtra } as any,
    produto: {
      itens, percentualTributos: 13,
      aliquotas: { regime: "SIMPLES_NACIONAL", ramo: "PRODUTO", anexoSimples: "I", rbt12: 500000, aliquotaTotalEfetiva: 13, detalhes: {} },
      margens: { piso: 5, alvo: 12, inicial: 20, despesas: 8, origem: "APRENDIDO", amostras: 3 }, ...extra,
    } as any,
  };
}
const html = (p: PacoteAba) => renderToStaticMarkup(<EstudoProdutoAba pacote={p} onPacote={() => {}} />);

describe("EstudoProdutoAba (renderização)", () => {
  it("sem custo: avisa que está incompleto e bloqueia o botão de concluir", () => {
    const h = html(pacote([item()]));
    expect(h).toContain("Falta informar o custo");
    expect(h).toContain("Estudo incompleto");
    expect(h).toMatch(/<button[^>]*disabled[^>]*>[^<]*(<svg[\s\S]*?<\/svg>)?Concluir estudo/);
    expect(h).toContain("Informe o custo de compra para ver os preços deste item.");
  });

  it("com custos do histórico: mostra a sugestão, os três cenários e o veredito", () => {
    const h = html(pacote([item({
      custos: { custoAquisicaoUnitario: 100, freteLogistica: 50, icmsStDifal: 30, fornecedor: "Dell" }, fonteCusto: "HISTORICO",
      sugestao: { similaridade: 1, rotulo: "Pregão da Saúde", atualizadoEm: "2026-08-10T00:00:00Z", ocorrencias: 2, ajustouPorQuantidade: true },
    })]));
    expect(h).toContain("Sugerido pelo seu histórico");
    expect(h).toContain("Pregão da Saúde");
    expect(h).toContain("ajustados à quantidade");
    expect(h).toContain("Viável e competitivo");
    expect(h).toContain("Inicial"); expect(h).toContain("Alvo"); expect(h).toContain("Piso");
    expect(h).toContain("1.555,20"); // preço alvo
    expect(h).toContain("1.422,44"); // preço piso
    expect(h).toContain("12,0%");
  });

  it("valor do edital baixo: mostra Inviável", () => {
    const h = html(pacote([item({ valorUnitarioReferencia: 130, valorTotalReferencia: 1300,
      custos: { custoAquisicaoUnitario: 100, freteLogistica: 50, icmsStDifal: 30, fornecedor: "" }, fonteCusto: "SALVO" })]));
    expect(h).toContain("Inviável");
    expect(h).toContain("acima do valor do edital");
  });

  it("edital sem valor divulgado: pede o valor de referência e não dá veredito", () => {
    const h = html(pacote([item({ valorUnitarioReferencia: 0, valorTotalReferencia: 0,
      custos: { custoAquisicaoUnitario: 100, freteLogistica: 0, icmsStDifal: 0, fornecedor: "" }, fonteCusto: "SALVO" })]));
    expect(h).toContain("Valor de referência por unidade");
    expect(h).toContain("Sem valor de referência");
    expect(h).toContain("Estudo incompleto");
  });

  it("sem regime confirmado: pede o regime e esconde os preços", () => {
    const p = pacote([item()]);
    p.produto!.percentualTributos = null; p.produto!.aliquotas = null;
    const h = html(p);
    expect(h).toContain("Como a sua empresa paga imposto?");
    expect(h).toContain("Confirme o regime acima");
  });

  it("estudo concluído mostra o botão do relatório", () => {
    const h = html(pacote([item({ custos: { custoAquisicaoUnitario: 100, freteLogistica: 50, icmsStDifal: 30, fornecedor: "" }, fonteCusto: "SALVO" })],
      {}, { calculoConfirmadoEm: "2026-10-05T12:00:00Z", custosConfirmadoEm: "2026-10-05T12:00:00Z" }));
    expect(h).toContain("Estudo concluído em");
    expect(h).toContain("Ver relatório e PDF");
  });
});
