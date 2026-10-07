import { describe, it, expect } from "vitest";
import { normalizarBusca } from "@/components/empresa/SegmentoLicitaNetSelect";
import { SEGMENTOS_LICITANET } from "@/lib/licitanet-segmentos";

describe("busca de segmento do LicitaNet", () => {
  it("ignora acentos e maiúsculas", () => {
    expect(normalizarBusca("  Alimentação ESPECIAL ")).toBe("alimentacao especial");
  });

  it("encontra por parte do nome, com ou sem acento", () => {
    const acha = (t: string) => SEGMENTOS_LICITANET.filter((s) => normalizarBusca(s.nome).includes(normalizarBusca(t)));
    expect(acha("alimentacao").length).toBeGreaterThan(0);
    expect(acha("ALIMENTAÇÃO").length).toBe(acha("alimentacao").length);
    expect(acha("hospitalar").length).toBeGreaterThan(0);
  });
});
