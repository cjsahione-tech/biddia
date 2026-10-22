import { beforeEach, describe, expect, it } from "vitest";
import {
  ArmazenamentoIndisponivelError,
  armazenamentoLiberado,
  ehErroDeArmazenamentoIndisponivel,
  ehRestricaoDeArmazenamento,
  exigirArmazenamentoLiberado,
  marcarArmazenamentoBloqueado,
  marcarArmazenamentoLiberado,
} from "@/lib/armazenamento-estado";

describe("restrição do Storage", () => {
  it("reconhece a mensagem real do Supabase (cota de tráfego estourada)", () => {
    const real = "Service for this project is restricted due to the following violations: exceed_egress_quota. The project owner must upgrade their plan or remove spend caps to restore service.";
    expect(ehRestricaoDeArmazenamento(real)).toBe(true);
    expect(ehRestricaoDeArmazenamento("exceed_storage_quota")).toBe(true);
    expect(ehRestricaoDeArmazenamento("qualquer coisa", 402)).toBe(true);
  });
  it("erro comum de um arquivo (não existe, sem permissão) NÃO é bloqueio", () => {
    expect(ehRestricaoDeArmazenamento("Object not found", 404)).toBe(false);
    expect(ehRestricaoDeArmazenamento("The resource was not found")).toBe(false);
    expect(ehRestricaoDeArmazenamento("new row violates row-level security policy", 403)).toBe(false);
  });
  it("o erro tipado é reconhecido mesmo depois de atravessar camadas", () => {
    expect(ehErroDeArmazenamentoIndisponivel(new ArmazenamentoIndisponivelError())).toBe(true);
    expect(ehErroDeArmazenamentoIndisponivel(new Error("outro"))).toBe(false);
    expect(ehErroDeArmazenamentoIndisponivel("texto")).toBe(false);
  });
});

describe("disjuntor do Storage", () => {
  beforeEach(() => marcarArmazenamentoLiberado());
  it("começa liberado, fecha por 3 minutos depois de um bloqueio e volta sozinho", () => {
    const t0 = 1_000_000;
    expect(armazenamentoLiberado(t0)).toBe(true);
    marcarArmazenamentoBloqueado(t0);
    expect(armazenamentoLiberado(t0 + 60_000)).toBe(false);
    expect(() => exigirArmazenamentoLiberado(t0 + 60_000)).toThrow(ArmazenamentoIndisponivelError);
    expect(armazenamentoLiberado(t0 + 3 * 60_000 + 1)).toBe(true);
  });
  it("uma chamada que deu certo reabre na hora", () => {
    marcarArmazenamentoBloqueado(1);
    marcarArmazenamentoLiberado();
    expect(armazenamentoLiberado(2)).toBe(true);
  });
});
