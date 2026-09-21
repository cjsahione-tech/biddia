import { describe, expect, it } from "vitest";
import { houveRetificacao } from "@/lib/edital-retificacao";

describe("houveRetificacao", () => {
  it("sem data nova nenhuma (PNCP não informou), nunca é retificação", () => {
    expect(houveRetificacao(new Date("2026-01-01"), null)).toBe(false);
    expect(houveRetificacao(null, null)).toBe(false);
  });

  it("sem data salva antes (primeira vez que essa informação chega), qualquer data nova conta como retificação", () => {
    expect(houveRetificacao(null, new Date("2026-01-01"))).toBe(true);
  });

  it("data nova mais recente que a salva é retificação", () => {
    expect(houveRetificacao(new Date("2026-01-01"), new Date("2026-01-02"))).toBe(true);
  });

  it("data nova igual ou mais antiga que a salva não é retificação", () => {
    expect(houveRetificacao(new Date("2026-01-02"), new Date("2026-01-02"))).toBe(false);
    expect(houveRetificacao(new Date("2026-01-02"), new Date("2026-01-01"))).toBe(false);
  });
});
