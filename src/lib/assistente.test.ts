/* eslint-disable @typescript-eslint/no-explicit-any -- os mocks deste teste usam any de propósito (dados de mentira) */
import { describe, expect, it, vi } from "vitest";

const editais = vi.hoisted(() => [] as any[]);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    edital: {
      findMany: async () => editais,
      findFirst: async ({ where }: any) => editais.find((e) => e.id === where.id) ?? null,
    },
  },
}));
// Módulos pesados que o assistente importa para gerar arquivos — não participam destes testes.
vi.mock("@/lib/proposal-planilha", () => ({ gerarPlanilhaProposta: vi.fn() }));
vi.mock("@/lib/checklist-zip", () => ({ gerarChecklistZip: vi.fn() }));
vi.mock("@/lib/agents/pdf", () => ({ gerarPdfRelatorio: vi.fn() }));
vi.mock("@/lib/estudo-server", () => ({ montarRelatorioEstudo: vi.fn() }));

import { criarExecutorAssistente, systemPromptAssistente } from "@/lib/assistente";

const base = { orgaoNome: "Prefeitura", orcamentoSigiloso: false, dataEncerramentoProposta: null, proposal: null, resultado: null, descricao: "Objeto", analysis: null, checklistItems: [] };
const ed = (id: string, etapaKanban: string, extra: Record<string, unknown> = {}) => ({ ...base, id, titulo: `Edital ${id}`, etapaKanban, valorGlobal: 1000, ...extra });

describe("assistente — ferramentas", () => {
  it("listar_editais: nome da etapa como na tela, situação, contagens exatas e valor homologado dos ganhos", async () => {
    editais.length = 0;
    editais.push(
      ed("g1", "ACEITA", { valorGlobal: 3_500_000, resultado: { valorHomologado: 3_000_000 } }),
      ed("g2", "EM_CONTRATO"), // ganho sem valor homologado registrado
      ed("r1", "RASCUNHO"),
      ed("r2", "RASCUNHO"),
      ed("q1", "QUALIFICACAO"),
      ed("p1", "RECUSADA_DESCLASSIFICADA")
    );
    const { resultadoTexto } = await criarExecutorAssistente("c1")("listar_editais", {});

    expect(resultadoTexto).toContain("6 edital(is).");
    expect(resultadoTexto).toContain("Por situação: 3 em andamento, 2 ganho(s), 1 perdido(s).");
    expect(resultadoTexto).toContain("Rascunho: 2");
    expect(resultadoTexto).toContain("Qualificação: 1");
    // a etapa ACEITA aparece como "Ganhas", nunca como o código
    expect(resultadoTexto).toContain("etapa: Ganhas — situação: ganho");
    expect(resultadoTexto).not.toMatch(/etapa: ACEITA/);
    expect(resultadoTexto).toMatch(/valor estimado: R\$\s*3\.500\.000,00 — valor homologado: R\$\s*3\.000\.000,00/);
    expect(resultadoTexto).toContain("valor homologado: não registrado");
    // quem não é ganho não mostra valor homologado
    const linhaRascunho = resultadoTexto.split("\n").find((l) => l.includes("[r1]"))!;
    expect(linhaRascunho).toContain("situação: em andamento");
    expect(linhaRascunho).not.toContain("homologado");
  });

  it("detalhar_edital: informa o valor homologado de um ganho (ou que ainda não foi registrado)", async () => {
    editais.length = 0;
    editais.push(ed("g1", "ACEITA", { resultado: { valorHomologado: 850_000 } }), ed("g2", "FINALIZADA"), ed("x1", "QUALIFICACAO"));
    const exec = criarExecutorAssistente("c1");
    expect((await exec("detalhar_edital", { editalId: "g1" })).resultadoTexto).toMatch(/Valor homologado: R\$\s*850\.000,00/);
    expect((await exec("detalhar_edital", { editalId: "g2" })).resultadoTexto).toContain("Valor homologado: ainda não registrado");
    const emAndamento = (await exec("detalhar_edital", { editalId: "x1" })).resultadoTexto;
    expect(emAndamento).not.toContain("Valor homologado");
    expect(emAndamento).toContain("Etapa no Kanban: Qualificação");
  });
});

describe("assistente — instruções de estilo", () => {
  const prompt = systemPromptAssistente("Laboratório São José");

  it("mantém o que já existia: dados da empresa, só leitura e arquivos", () => {
    expect(prompt).toContain('"Laboratório São José"');
    expect(prompt).toContain("nunca invente números");
    expect(prompt).toContain("LEITURA e GERAÇÃO DE ARQUIVO");
  });

  it("traz o bloco de estilo formal, sem markdown nem emojis, e a regra do valor homologado", () => {
    expect(prompt).toContain("ESTILO DE COMUNICAÇÃO");
    expect(prompt).toContain("Nunca use emojis");
    expect(prompt).toContain("não interpreta markdown");
    expect(prompt).toContain("VALOR HOMOLOGADO");
    expect(prompt).toContain("Primeiro a conclusão");
    expect(prompt).not.toContain("conversa entre colegas");
  });

  it("não deixa o modelo afirmar que é humano", () => {
    expect(prompt).toContain("nunca afirme ser humano");
  });
});
