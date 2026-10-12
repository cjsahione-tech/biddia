import { describe, it, expect, vi, beforeEach } from "vitest";

// Banco falso em memória: só a tabela ControleIA (uma linha, id "global").
type Linha = { id: string; saldoEsgotadoDesde: Date | null; motivo: string | null; pausadaAte: Date | null; ultimoTesteEm: Date | null; avisadoAdminEm: Date | null };
let linha: Linha | null = null;

vi.mock("@/lib/prisma", () => ({
  prisma: {
    controleIA: {
      findUnique: vi.fn(async () => (linha ? { ...linha } : null)),
      upsert: vi.fn(async ({ create, update }: { create: Partial<Linha>; update: Partial<Linha> }) => {
        linha = linha ? { ...linha, ...update } : ({ id: "global", saldoEsgotadoDesde: null, motivo: null, pausadaAte: null, ultimoTesteEm: null, avisadoAdminEm: null, ...create } as Linha);
        return linha;
      }),
      update: vi.fn(async ({ data }: { data: Partial<Linha> }) => {
        linha = { ...(linha as Linha), ...data };
        return linha;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Partial<Linha>; data: Partial<Linha> }) => {
        if (!linha) return { count: 0 };
        for (const [k, v] of Object.entries(where)) {
          const atual = (linha as unknown as Record<string, unknown>)[k];
          const igual = v instanceof Date && atual instanceof Date ? v.getTime() === atual.getTime() : atual === v;
          if (!igual) return { count: 0 };
        }
        linha = { ...linha, ...data };
        return { count: 1 };
      }),
    },
  },
}));

const SALDO = Object.assign(new Error('400 {"error":{"message":"Your credit balance is too low to access the Anthropic API."}}'), { status: 400 });

async function carregar() {
  vi.resetModules();
  return import("@/lib/controle-ia");
}

beforeEach(() => {
  linha = null;
});

describe("disjuntor da IA", () => {
  it("livre: deixa passar sem testar nada", async () => {
    const { garantirIALiberada } = await carregar();
    const testar = vi.fn();
    await garantirIALiberada(testar);
    expect(testar).not.toHaveBeenCalled();
  });

  it("saldo esgotado abre o disjuntor; depois disso falha na hora, sem chamar a API", async () => {
    const { registrarFalhaIA, garantirIALiberada, lerEstadoIA } = await carregar();
    await registrarFalhaIA(SALDO);

    const estado = await lerEstadoIA();
    expect(estado.pausada).toBe(true);
    expect(estado.motivo).toBe("SALDO_INSUFICIENTE");

    const testar = vi.fn();
    await expect(garantirIALiberada(testar)).rejects.toMatchObject({ tipo: "SALDO_INSUFICIENTE" });
    expect(testar).not.toHaveBeenCalled(); // pausa ainda vale: nenhuma chamada à API
  });

  it("erro que não é de saldo/chave (ex.: 429) não abre o disjuntor", async () => {
    const { registrarFalhaIA, lerEstadoIA } = await carregar();
    await registrarFalhaIA(Object.assign(new Error("rate_limit"), { status: 429 }));
    expect((await lerEstadoIA()).pausada).toBe(false);
  });

  it("pausa vencida: faz UM teste mínimo; se passar, fecha e retoma", async () => {
    const { registrarFalhaIA, garantirIALiberada, lerEstadoIA } = await carregar();
    await registrarFalhaIA(SALDO);
    linha!.pausadaAte = new Date(Date.now() - 1000); // pausa venceu

    const testar = vi.fn(async () => {});
    await garantirIALiberada(testar);
    expect(testar).toHaveBeenCalledTimes(1);
    expect((await lerEstadoIA()).pausada).toBe(false);
  });

  it("pausa vencida mas o saldo continua zerado: renova a pausa e continua bloqueando", async () => {
    const { registrarFalhaIA, garantirIALiberada, lerEstadoIA } = await carregar();
    await registrarFalhaIA(SALDO);
    linha!.pausadaAte = new Date(Date.now() - 1000);

    await expect(garantirIALiberada(async () => Promise.reject(SALDO))).rejects.toMatchObject({ tipo: "SALDO_INSUFICIENTE" });
    const estado = await lerEstadoIA();
    expect(estado.pausada).toBe(true);
    expect(estado.pausadaAte!.getTime()).toBeGreaterThan(Date.now() + 5 * 60_000); // ~10 min à frente
  });

  it("duas funções ao mesmo tempo: só uma faz o teste", async () => {
    const { registrarFalhaIA, garantirIALiberada } = await carregar();
    await registrarFalhaIA(SALDO);
    linha!.pausadaAte = new Date(Date.now() - 1000);

    let liberaTeste: () => void = () => {};
    const testarLento = vi.fn(() => new Promise<void>((r) => (liberaTeste = r)));
    const primeira = garantirIALiberada(testarLento);
    await new Promise((r) => setTimeout(r, 10)); // a primeira já reservou a janela do teste
    const testarOutra = vi.fn(async () => {});
    await expect(garantirIALiberada(testarOutra)).rejects.toMatchObject({ tipo: "SALDO_INSUFICIENTE" });
    expect(testarOutra).not.toHaveBeenCalled();
    liberaTeste();
    await primeira;
    expect(testarLento).toHaveBeenCalledTimes(1);
  });

  it("falha do teste por motivo passageiro (sobrecarga) libera: a conta tem saldo", async () => {
    const { registrarFalhaIA, garantirIALiberada, lerEstadoIA } = await carregar();
    await registrarFalhaIA(SALDO);
    linha!.pausadaAte = new Date(Date.now() - 1000);

    await garantirIALiberada(async () => Promise.reject(Object.assign(new Error("overloaded"), { status: 529 })));
    expect((await lerEstadoIA()).pausada).toBe(false);
  });
});
