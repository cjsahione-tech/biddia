import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let resultadoDoAgente: unknown;
let agenteFalha: Error | null = null;
vi.mock("@/lib/agents/agente1-comercial", () => ({
  executarAgente1: async () => {
    if (agenteFalha) throw agenteFalha;
    return resultadoDoAgente;
  },
}));

const atualizacoes: { id: string; data: Record<string, unknown> }[] = [];
let runsRodando: { id: string }[] = [];
vi.mock("@/lib/prisma", () => ({
  prisma: {
    captacaoRun: {
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        atualizacoes.push({ id: where.id, data });
        return {};
      },
      updateMany: async () => ({ count: 0 }),
      findFirst: async () => runsRodando[0] ?? null,
      create: async () => ({ id: "run-novo", status: "RUNNING" }),
    },
    company: { findUnique: async () => ({ razaoSocial: "Empresa", whatsapp: null, user: { email: "e@e.com" } }) },
  },
}));

const avisos: number[] = [];
vi.mock("@/lib/notifications", () => ({ notificarNovosEditais: async (_d: unknown, n: number) => void avisos.push(n) }));
vi.mock("@/lib/ia-erros", () => ({ descreverErro: (e: unknown) => String(e) }));
const depois: (() => unknown)[] = [];
vi.mock("next/server", () => ({ after: (fn: () => unknown) => void depois.push(fn) }));

import type { EstadoCaptacao } from "@/lib/agents/agente1-comercial";
import { MAX_ETAPAS_EXTRAS, caberNoCorpo, dispararCaptacaoAgendada, executarEtapaDaCaptacao, iniciarCaptacao } from "@/lib/captacao";

const estado = (n: number): EstadoCaptacao => ({
  // Só importam as chaves; o resto do edital é simulado.
  pendentesClassificar: Array.from({ length: n }, (_, i) => ({ fonte: "PNCP" as const, numeroControle: `E${i}`, titulo: "t", descricao: "d", item: {} as never, keyword: "k" })),
  pendentesCriar: [],
  classificacoes: {},
  acumulado: { analisados: n, novos: 5, descartadosPerfil: 0, descartadosRelevancia: 0, retificados: 0, falhasPncp: 0 },
});
const concluido = { novos: 20, analisados: 100, mensagem: "20 novo(s) edital(is) captado(s)." };
const incompleto = { novos: 5, analisados: 100, mensagem: "5 novo(s) edital(is) captado(s).", estado: estado(40) };

const fetchMock = vi.fn();
beforeEach(() => {
  atualizacoes.length = 0;
  avisos.length = 0;
  depois.length = 0;
  runsRodando = [];
  agenteFalha = null;
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, status: 202 });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("CRON_SECRET", "segredo");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const ultimaAtualizacao = () => atualizacoes[atualizacoes.length - 1]?.data;

describe("busca de editais em etapas encadeadas", () => {
  it("terminou na 1ª etapa: encerra como concluída", async () => {
    resultadoDoAgente = concluido;
    await executarEtapaDaCaptacao({ companyId: "c1", runId: "r1", etapa: 0 }, "https://app.test");
    expect(ultimaAtualizacao()).toMatchObject({ status: "DONE", fase: "concluida", novos: 20 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sobrou trabalho: chama a próxima etapa (com o estado e o segredo) e a busca segue em andamento", async () => {
    resultadoDoAgente = incompleto;
    await executarEtapaDaCaptacao({ companyId: "c1", runId: "r1", etapa: 0, notificar: true }, "https://app.test");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://app.test/api/editais/search/continuar");
    expect(init.headers.Authorization).toBe("Bearer segredo");
    const corpo = JSON.parse(init.body);
    expect(corpo).toMatchObject({ companyId: "c1", runId: "r1", etapa: 1, notificar: true });
    expect(corpo.estado.pendentesClassificar).toHaveLength(40);
    // não foi marcada como concluída
    expect(atualizacoes.some((a) => a.data.status === "DONE")).toBe(false);
  });

  it("na última etapa permitida, encerra dizendo a verdade e como continuar", async () => {
    resultadoDoAgente = incompleto;
    await executarEtapaDaCaptacao({ companyId: "c1", runId: "r1", etapa: MAX_ETAPAS_EXTRAS, estado: estado(40) }, "https://app.test");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(ultimaAtualizacao()).toMatchObject({ status: "DONE" });
    expect(String(ultimaAtualizacao()?.mensagem)).toContain("Ainda restam cerca de 40 edital(is)");
    expect(String(ultimaAtualizacao()?.mensagem)).toContain("Buscar");
  });

  it("se não conseguir chamar a próxima etapa, também encerra com honestidade (nada fica buscando para sempre)", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue({ ok: false, status: 508 });
    resultadoDoAgente = incompleto;
    const p = executarEtapaDaCaptacao({ companyId: "c1", runId: "r1", etapa: 0 }, "https://app.test");
    await vi.runAllTimersAsync();
    await p;
    vi.useRealTimers();
    expect(fetchMock).toHaveBeenCalledTimes(2); // tentou duas vezes
    expect(ultimaAtualizacao()).toMatchObject({ status: "DONE" });
    expect(String(ultimaAtualizacao()?.mensagem)).toContain("Ainda restam");
  });

  it("sem endereço do sistema (origin), a busca termina na etapa com o aviso do que sobrou", async () => {
    resultadoDoAgente = incompleto;
    await executarEtapaDaCaptacao({ companyId: "c1", runId: "r1", etapa: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(String(ultimaAtualizacao()?.mensagem)).toContain("Ainda restam");
  });

  it("erro do agente vira erro na busca, com o motivo", async () => {
    agenteFalha = new Error("PNCP fora do ar");
    await executarEtapaDaCaptacao({ companyId: "c1", runId: "r1", etapa: 0 }, "https://app.test");
    expect(ultimaAtualizacao()).toMatchObject({ status: "ERROR" });
    expect(String(ultimaAtualizacao()?.mensagem)).toContain("PNCP fora do ar");
  });

  it("a busca agendada avisa a empresa só quando termina de verdade e com editais novos", async () => {
    resultadoDoAgente = concluido;
    await executarEtapaDaCaptacao({ companyId: "c1", runId: "r1", etapa: 1, notificar: true }, "https://app.test");
    expect(avisos).toEqual([20]);
    avisos.length = 0;
    resultadoDoAgente = { ...concluido, novos: 0 };
    await executarEtapaDaCaptacao({ companyId: "c1", runId: "r2", etapa: 0, notificar: true });
    expect(avisos).toEqual([]);
    resultadoDoAgente = incompleto;
    await executarEtapaDaCaptacao({ companyId: "c1", runId: "r3", etapa: 0, notificar: true }, "https://app.test");
    expect(avisos).toEqual([]); // ainda não terminou: avisa só no fim
  });
});

describe("início da busca", () => {
  it("agenda a 1ª etapa em segundo plano e devolve a execução na hora", async () => {
    resultadoDoAgente = concluido;
    const r = await iniciarCaptacao("c1", { origin: "https://app.test" });
    expect(r.jaEmAndamento).toBe(false);
    expect(depois).toHaveLength(1);
  });

  it("não abre outra busca se já há uma em andamento", async () => {
    runsRodando = [{ id: "rodando" }];
    const r = await iniciarCaptacao("c1");
    expect(r.jaEmAndamento).toBe(true);
    expect(depois).toHaveLength(0);
  });

  it("a busca agendada entrega a 1ª etapa a uma invocação própria de cada empresa", async () => {
    const r = await dispararCaptacaoAgendada("c1", "https://app.test");
    expect(r.iniciada).toBe(true);
    const corpo = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(corpo).toMatchObject({ companyId: "c1", etapa: 0, notificar: true });
  });

  it("a busca agendada não duplica uma busca já em andamento", async () => {
    runsRodando = [{ id: "rodando" }];
    const r = await dispararCaptacaoAgendada("c1", "https://app.test");
    expect(r.iniciada).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("tamanho do que passa de uma etapa para a outra", () => {
  it("corta candidatos até caber no limite do corpo (o resto é achado numa próxima busca)", () => {
    const pedido = { companyId: "c", runId: "r", etapa: 1, estado: estado(400) };
    const { corpo, cortados } = caberNoCorpo(pedido, 20_000);
    expect(corpo.length).toBeLessThanOrEqual(20_000);
    expect(cortados).toBeGreaterThan(0);
    expect(JSON.parse(corpo).estado.pendentesClassificar.length).toBe(400 - cortados);
  });

  it("não corta nada quando cabe", () => {
    expect(caberNoCorpo({ companyId: "c", runId: "r", etapa: 1, estado: estado(10) }).cortados).toBe(0);
  });
});
