import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── relógio controlado: cada chamada da IA "gasta" tempo, para simular o limite de 60s sem esperar
let agora = 1_000_000;
let gastoPorClassificacao = 0;

// ── mundo simulado
const criados = new Set<string>();
let totalNoPncp = 150;
const chamadas = { buscas: 0, classificacoes: 0 };

vi.mock("@/lib/prisma", () => ({
  prisma: {
    company: {
      findUnique: async () => ({
        id: "c1",
        keywords: [{ term: "exames" }],
        licitanetSegmentoId: null,
        licitanetSegmentoNome: null,
        objetoSocial: "Laboratório de análises clínicas",
        atendeServico: true,
        atendeBem: true,
      }),
    },
    edital: {
      findMany: async ({ where }: { where: { numeroControlePNCP: { in: string[] } } }) =>
        where.numeroControlePNCP.in.filter((k) => criados.has(k)).map((k) => ({ id: k, numeroControlePNCP: k, dataAtualizacaoPncp: null, orcamentoSigiloso: false, linkPortal: null })),
      create: async ({ data }: { data: { numeroControlePNCP: string } }) => {
        criados.add(data.numeroControlePNCP);
        return { id: data.numeroControlePNCP };
      },
    },
    editalExcluido: { findMany: async () => [] },
    document: { create: async () => ({}) },
  },
}));

vi.mock("@/lib/agents/pncp", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/agents/pncp")>();
  return {
    ...original,
    searchEditaisPorPalavraChave: async () => {
      chamadas.buscas++;
      return Array.from({ length: totalNoPncp }, (_, i) => ({
        numero_controle_pncp: `E${i + 1}`,
        title: `Edital ${i + 1}`,
        description: "exames laboratoriais",
        item_url: `/compras/12345678000100/2026/${i + 1}`,
        orgao_nome: "Prefeitura",
        orgao_cnpj: "12345678000100",
        municipio_nome: "SP",
        uf: "SP",
        modalidade_licitacao_nome: "Pregão",
        situacao_nome: "Divulgada",
        data_publicacao_pncp: null,
        data_atualizacao_pncp: null,
        data_inicio_vigencia: null,
        data_fim_vigencia: null,
        valor_global: 1000,
      }));
    },
    buscarDetalheCompra: async () => null,
    buscarArquivosCompra: async () => [],
    buscarItensCompra: async () => null,
  };
});

// A cada 10º edital a IA diz "sem relação com a empresa" (não vira card).
vi.mock("@/lib/agents/relevancia", () => ({
  classificarEditaisEmLote: async (_objeto: string, lista: { numeroControle: string }[]) => {
    chamadas.classificacoes++;
    agora += gastoPorClassificacao;
    return new Map(lista.map((c) => [c.numeroControle, { relevante: !c.numeroControle.endsWith("0"), tipoObjeto: "SERVICO" as const }]));
  },
}));

vi.mock("@/lib/anthropic", () => ({ askJSON: vi.fn(), MODELO_HAIKU: "haiku" }));
vi.mock("@/lib/storage", () => ({ baixarAnexo: vi.fn() }));
vi.mock("@/lib/agents/document-download", () => ({ baixarEPersistirDocumento: vi.fn() }));
vi.mock("@/lib/agents/pdf-extract", () => ({ extrairTextoPdf: vi.fn(), base64ParaBytes: vi.fn() }));
vi.mock("@/lib/agents/run-tracker", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/plano", () => ({ verificarAcessoPlano: async () => false }));

import { executarAgente1 } from "@/lib/agents/agente1-comercial";

beforeEach(() => {
  agora = 1_000_000;
  gastoPorClassificacao = 0;
  criados.clear();
  totalNoPncp = 150;
  chamadas.buscas = 0;
  chamadas.classificacoes = 0;
  vi.spyOn(Date, "now").mockImplementation(() => agora);
});
afterEach(() => vi.restoreAllMocks());

// 150 editais, 15 terminam em 0 (a IA descarta) → 135 aprovados
const APROVADOS = 135;

describe("busca do Agente Comercial em etapas", () => {
  it("sem limite de tempo, traz todos os editais adequados de uma vez (e nada fica pendente)", async () => {
    const r = await executarAgente1("c1");
    expect(r.novos).toBe(APROVADOS);
    expect(r.estado).toBeUndefined();
    expect(criados.size).toBe(APROVADOS);
  });

  it("quando o tempo da etapa acaba no meio, devolve o que sobrou — e a etapa seguinte termina SEM refazer a busca", async () => {
    gastoPorClassificacao = 5_000;
    // limite curto: avalia só o 1º bloco de 60 e para.
    const etapa1 = await executarAgente1("c1", undefined, { limiteMs: agora + 8_000 });
    expect(etapa1.estado).toBeDefined();
    expect(etapa1.novos).toBeGreaterThan(0);
    expect(etapa1.novos).toBeLessThan(APROVADOS);
    expect(etapa1.estado!.pendentesClassificar.length).toBe(90); // 150 - 60 já avaliados

    gastoPorClassificacao = 0;
    const etapa2 = await executarAgente1("c1", undefined, { estado: etapa1.estado });
    expect(etapa2.estado).toBeUndefined();
    expect(etapa2.novos).toBe(APROVADOS); // total da busca inteira (soma das etapas)
    expect(criados.size).toBe(APROVADOS);
    expect(chamadas.buscas).toBe(1); // o PNCP foi consultado uma vez só
  });

  it("aprovado que não deu tempo de virar card vai no estado (com a decisão da IA) e é criado na etapa seguinte sem avaliar de novo", async () => {
    gastoPorClassificacao = 8_000; // depois do 1º bloco o tempo já passou do limite
    const etapa1 = await executarAgente1("c1", undefined, { limiteMs: agora + 7_000 });
    expect(etapa1.novos).toBe(0);
    expect(etapa1.estado!.pendentesCriar.length).toBe(54); // 60 do bloco - 6 descartados (terminam em 0)
    expect(Object.keys(etapa1.estado!.classificacoes)).toHaveLength(54);
    const avaliacoesAteAqui = chamadas.classificacoes;

    gastoPorClassificacao = 0;
    const etapa2 = await executarAgente1("c1", undefined, { estado: etapa1.estado });
    expect(etapa2.novos).toBe(APROVADOS);
    expect(etapa2.estado).toBeUndefined();
    // os 54 já aprovados NÃO foram avaliados outra vez: só os 90 restantes (2 blocos de 60/30)
    expect(chamadas.classificacoes - avaliacoesAteAqui).toBe(2);
  });

  it("os descartados pela IA são somados entre as etapas na mensagem final", async () => {
    gastoPorClassificacao = 5_000;
    const etapa1 = await executarAgente1("c1", undefined, { limiteMs: agora + 8_000 });
    gastoPorClassificacao = 0;
    const etapa2 = await executarAgente1("c1", undefined, { estado: etapa1.estado });
    expect(etapa2.mensagem).toContain(`${APROVADOS} novo(s) edital(is) captado(s)`);
    expect(etapa2.mensagem).toContain("15 não listado(s)");
  });

  it("editais que já viraram card (outra busca, outro clique) não são criados de novo na continuação", async () => {
    gastoPorClassificacao = 5_000;
    const etapa1 = await executarAgente1("c1", undefined, { limiteMs: agora + 8_000 });
    // enquanto isso, alguém captou um dos pendentes por outro caminho
    const pendente = etapa1.estado!.pendentesClassificar.find((c) => !c.numeroControle.endsWith("0"))!;
    criados.add(pendente.numeroControle);
    gastoPorClassificacao = 0;
    const etapa2 = await executarAgente1("c1", undefined, { estado: etapa1.estado });
    expect(criados.size).toBe(APROVADOS);
    expect(etapa2.novos).toBe(APROVADOS - 1);
  });
});
