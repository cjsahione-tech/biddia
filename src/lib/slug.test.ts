import { describe, it, expect } from "vitest";
import { gerarSlug } from "@/lib/slug";

describe("gerarSlug", () => {
  it("tira acentos, espaços e símbolos", () => {
    expect(gerarSlug("Plano Médio — Hospitalar")).toBe("plano-medio-hospitalar");
    expect(gerarSlug("  Empresas do Analista  ")).toBe("empresas-do-analista");
  });
  it("devolve vazio quando não sobra nada aproveitável", () => {
    expect(gerarSlug("!!!")).toBe("");
  });
});
