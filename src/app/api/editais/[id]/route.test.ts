import { describe, it, expect, vi } from "vitest";

// Regressão: "abrir o edital" NÃO pode devolver o conteúdo dos arquivos. Com vários documentos
// baixados (conteudoBase64 / textoExtraido) a resposta passava de 30 MB, estourava o limite de ~4,5 MB
// da Vercel e a página do edital caía.
const capturado = vi.hoisted(() => ({ args: null as unknown as { include: { documents: { select?: Record<string, boolean> } } } | null }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    edital: {
      findFirst: async (args: never) => {
        capturado.args = args;
        return { id: "e1", visualizado: true, documents: [] };
      },
      update: async () => ({}),
    },
  },
}));
vi.mock("@/lib/api-utils", () => ({ requireCompany: async () => ({ user: null, company: { id: "c1" }, error: null }) }));

import { GET } from "@/app/api/editais/[id]/route";

describe("GET /api/editais/[id] — tamanho da resposta", () => {
  it("seleciona só os dados descritivos dos documentos, nunca o conteúdo do arquivo", async () => {
    const res = await GET(new Request("http://x"), { params: Promise.resolve({ id: "e1" }) });
    expect(res.status).toBe(200);

    const select = capturado.args?.include.documents.select;
    expect(select, "documents precisa ter `select` explícito (sem ele o Prisma traz todas as colunas)").toBeDefined();
    expect(select).not.toHaveProperty("conteudoBase64");
    expect(select).not.toHaveProperty("textoExtraido");
    // O que a tela usa continua vindo
    for (const campo of ["id", "nome", "tipo", "categoria", "status", "validade", "createdAt"]) expect(select).toHaveProperty(campo);
  });
});
