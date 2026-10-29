import { beforeEach, describe, expect, it, vi } from "vitest";

// IA simulada como função comum (ver agente3-releitura.test.ts: vi.fn atrapalha a falha simulada).
let comportamento: (chamada: unknown[]) => Promise<unknown> = async () => ({ declaracoes: [] });
const chamadas: unknown[][] = [];
vi.mock("@/lib/anthropic", () => ({
  askJSON: (...a: unknown[]) => {
    chamadas.push(a);
    return comportamento(a);
  },
  MODELO_HAIKU: "haiku",
  MODELO_SONNET: "sonnet",
}));

const edital = {
  titulo: "Pregão 12/2026",
  fonte: "PNCP",
  numeroControlePNCP: "123",
  orgaoNome: "Prefeitura X",
  orgaoCnpj: "00.000.000/0001-00",
  modalidade: "Pregão",
  descricao: "Coleta",
  analysis: null,
  company: {
    razaoSocial: "Empresa Teste Ltda",
    cnpj: "12.345.678/0001-90",
    logradouro: "Rua A",
    numero: "10",
    complemento: null,
    bairro: "Centro",
    cidade: "São Paulo",
    uf: "SP",
    cep: "01000-000",
    socioNome: "Maria Souza",
    socioCpf: "111.222.333-44",
    whatsapp: null,
    user: { email: "maria@teste.com" },
  },
};
const documentosCriados: { nome: string }[] = [];
vi.mock("@/lib/prisma", () => ({
  prisma: {
    edital: { findUniqueOrThrow: async () => edital },
    $transaction: async (fn: (tx: unknown) => unknown) =>
      fn({
        document: {
          deleteMany: async () => ({}),
          create: async ({ data }: { data: { nome: string } }) => {
            documentosCriados.push({ nome: data.nome });
            return data;
          },
        },
      }),
  },
}));

const textoDoEdital = `
ANEXO I – TERMO DE REFERÊNCIA
O objeto é a coleta de resíduos.

ANEXO II – MODELO DE DECLARAÇÃO DE INEXISTÊNCIA DE FATO IMPEDITIVO
A empresa ______________, CNPJ ____________, declara que inexiste fato impeditivo.

ANEXO III – DECLARAÇÃO DE ELABORAÇÃO INDEPENDENTE DE PROPOSTA
Declaramos que a proposta foi elaborada de maneira independente.
`;
vi.mock("@/lib/agents/pdf-extract", () => ({
  obterTextoCompletoEdital: async () => ({ textoEdital: textoDoEdital, textoTermoReferencia: null, textoAnexosPrecos: null, temTextoCompleto: true }),
}));

const auditorias: { severidade: string; mensagem: string }[] = [];
vi.mock("@/lib/agents/run-tracker", () => ({
  withAgentRun: async (_id: string, _k: string, fn: () => unknown) => fn(),
  logAudit: async (_id: string, _a: string, _e: string, severidade: string, mensagem: string) => {
    auditorias.push({ severidade, mensagem });
  },
}));

const opcoesPdf: Record<string, unknown>[] = [];
vi.mock("@/lib/agents/pdf", () => ({
  gerarPdfTimbrado: async (opts: Record<string, unknown>) => {
    opcoesPdf.push(opts);
    return new Uint8Array([1, 2, 3]);
  },
  bytesToDataUrl: () => "data:application/pdf;base64,AAA",
}));

import { executarAgente4 } from "@/lib/agents/agente4-advogado";

beforeEach(() => {
  chamadas.length = 0;
  documentosCriados.length = 0;
  auditorias.length = 0;
  opcoesPdf.length = 0;
  comportamento = async () => ({ declaracoes: [] });
});

const declaracao = (nome: string, texto: string) => ({
  declaracoes: [{ nome, paragrafos: [texto], camposNaoPreenchidos: [] }],
});

describe("Agente Advogado — um anexo de cada vez, sem esquecer nenhum", () => {
  it("lê cada anexo que é modelo (e só eles) e gera um PDF por modelo", async () => {
    comportamento = async (chamada) => {
      const entrada = String(chamada[1]);
      if (entrada.includes("ANEXO DO EDITAL: MODELO DE DECLARAÇÃO DE INEXISTÊNCIA"))
        return declaracao("Anexo II – Declaração de Inexistência de Fato Impeditivo", "A empresa Empresa Teste Ltda, CNPJ 12.345.678/0001-90, declara que inexiste fato impeditivo.");
      if (entrada.includes("ELABORAÇÃO INDEPENDENTE"))
        return declaracao("Anexo III – Declaração de Elaboração Independente de Proposta", "Declaramos que a proposta foi elaborada de maneira independente.");
      return { declaracoes: [] };
    };
    await executarAgente4("ed1");
    expect(documentosCriados.map((d) => d.nome).sort()).toEqual([
      "Anexo II – Declaração de Inexistência de Fato Impeditivo",
      "Anexo III – Declaração de Elaboração Independente de Proposta",
    ]);
    // O Termo de Referência (Anexo I) não foi mandado como modelo.
    expect(chamadas.some((c) => String(c[1]).includes("ANEXO DO EDITAL: TERMO DE REFERÊNCIA"))).toBe(false);
  });

  it("passa TODOS os dados da empresa para preencher as lacunas", async () => {
    comportamento = async () => ({ declaracoes: [] });
    await executarAgente4("ed1");
    const entrada = String(chamadas[0][1]);
    for (const dado of ["Empresa Teste Ltda", "12.345.678/0001-90", "Rua A, 10", "Maria Souza", "111.222.333-44", "maria@teste.com"]) {
      expect(entrada).toContain(dado);
    }
    expect(String(chamadas[0][0])).toContain("Preencha TODAS as lacunas");
  });

  it("o PDF sai sem nenhum rodapé ou marca de IA", async () => {
    comportamento = async () => declaracao("Declaração X", "A empresa Empresa Teste Ltda declara.");
    await executarAgente4("ed1");
    expect(opcoesPdf.length).toBeGreaterThan(0);
    for (const o of opcoesPdf) expect(o.rodapeExtra).toBeUndefined();
  });

  it("anexo que parecia modelo e a IA devolveu vazio: tenta o modelo forte e, se não sair, avisa (nunca some em silêncio)", async () => {
    comportamento = async () => ({ declaracoes: [] });
    await executarAgente4("ed1");
    const modelos = chamadas.map((c) => (c[2] as { model: string }).model);
    expect(modelos).toContain("sonnet");
    const aviso = auditorias.find((a) => a.severidade === "ALERTA");
    expect(aviso?.mensagem).toContain("não consegui reproduzi-los");
    expect(aviso?.mensagem).toContain("DECLARAÇÃO DE INEXISTÊNCIA");
  });

  it("remove marcação de markdown do texto", async () => {
    comportamento = async () => declaracao("Declaração Y", "**A empresa Empresa Teste Ltda** declara.");
    await executarAgente4("ed1");
    expect(JSON.stringify(opcoesPdf[0].paragrafos)).not.toContain("**");
  });
});
