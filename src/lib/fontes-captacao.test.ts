import { describe, expect, it } from "vitest";
import { FONTES_ATIVAS, fonteAtiva } from "@/lib/fontes-captacao";

describe("fontes de captação", () => {
  it("hoje só o PNCP capta editais novos", () => {
    expect(FONTES_ATIVAS).toEqual(["PNCP"]);
    expect(fonteAtiva("PNCP")).toBe(true);
    expect(fonteAtiva("LICITANET")).toBe(false);
    expect(fonteAtiva("COMPRASGOV")).toBe(false);
  });
});
