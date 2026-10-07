import { describe, it, expect, vi, beforeEach } from "vitest";

// Cria plano no Admin: o erro "Too small: expected string to have >=1 characters" vinha do
// campo slug (obrigatório e técnico). Agora o slug é opcional e gerado a partir do nome.
const plans = new Map<string, { slug: string }>();
const criados: Record<string, unknown>[] = [];

vi.mock("@/lib/admin", () => ({ requireAdmin: async () => ({ error: null }) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    plan: {
      findUnique: async ({ where }: { where: { slug: string } }) => plans.get(where.slug) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        criados.push(data);
        plans.set(data.slug as string, { slug: data.slug as string });
        return { id: "p" + criados.length, ...data };
      },
      findMany: async () => [],
    },
  },
}));

import { POST } from "@/app/api/admin/planos/route";

const base = {
  nome: "Plano Ouro",
  publicoAlvo: "EMPRESA_ANALISTA",
  precoMensal: 199,
  ordemExibicao: 0,
  featureIds: [],
};

const post = (body: unknown) =>
  POST(new Request("http://x/api/admin/planos", { method: "POST", body: JSON.stringify(body) }));

describe("POST /api/admin/planos", () => {
  beforeEach(() => {
    plans.clear();
    criados.length = 0;
  });

  it("cria o plano sem slug, gerando-o a partir do nome", async () => {
    const res = await post({ ...base, slug: "" });
    expect(res.status).toBe(200);
    expect(criados[0].slug).toBe("plano-ouro");
    expect(criados[0].publicoAlvo).toBe("EMPRESA_ANALISTA");
  });

  it("cria o plano com o campo slug nem enviado", async () => {
    const res = await post(base);
    expect(res.status).toBe(200);
    expect(criados[0].slug).toBe("plano-ouro");
  });

  it("nome repetido ganha sufixo em vez de dar erro", async () => {
    await post(base);
    await post(base);
    expect(criados.map((c) => c.slug)).toEqual(["plano-ouro", "plano-ouro-2"]);
  });

  it("slug digitado que já existe avisa em português", async () => {
    await post({ ...base, slug: "ouro" });
    const res = await post({ ...base, slug: "ouro" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/já existe/i);
  });

  it("nome em branco dá mensagem clara em português", async () => {
    const res = await post({ ...base, nome: "   " });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Informe o nome do plano");
  });

  it("slug com caracteres inválidos dá mensagem clara", async () => {
    const res = await post({ ...base, slug: "Plano Ouro!" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/slug/i);
  });
});
