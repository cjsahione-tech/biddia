import { describe, expect, it } from "vitest";
import {
  DIAS_RASCUNHO,
  LIMITE_RASCUNHO_MS,
  diasRestantesRascunho,
  entradaNoRascunho,
  filtroRascunhoVencido,
} from "@/lib/rascunho-prazo";

const agora = new Date("2026-10-14T12:00:00.000Z");
const diasAtras = (d: number) => new Date(agora.getTime() - d * 24 * 3_600_000);

describe("expiração do Rascunho (7 dias)", () => {
  it("o prazo é de 7 dias", () => {
    expect(DIAS_RASCUNHO).toBe(7);
    expect(LIMITE_RASCUNHO_MS).toBe(7 * 24 * 3_600_000);
  });

  it("conta a partir de quando entrou no Rascunho (movidoEm)", () => {
    const e = { movidoEm: diasAtras(2), ultimaMovimentacao: diasAtras(30) };
    expect(entradaNoRascunho(e).getTime()).toBe(diasAtras(2).getTime());
    expect(diasRestantesRascunho(e, agora)).toBe(5);
  });

  it("card antigo sem movidoEm usa a última movimentação", () => {
    const e = { movidoEm: null, ultimaMovimentacao: diasAtras(6) };
    expect(diasRestantesRascunho(e, agora)).toBe(1);
  });

  it("recém-chegado tem 7 dias; passado do prazo fica em 0, nunca negativo", () => {
    expect(diasRestantesRascunho({ movidoEm: agora, ultimaMovimentacao: agora }, agora)).toBe(7);
    expect(diasRestantesRascunho({ movidoEm: diasAtras(20), ultimaMovimentacao: agora }, agora)).toBe(0);
  });

  it("o filtro olha só o Rascunho e usa as duas datas", () => {
    const f = filtroRascunhoVencido(agora);
    const corte = diasAtras(7);
    expect(f.etapaKanban).toBe("RASCUNHO");
    expect(f.OR).toEqual([{ movidoEm: { lt: corte } }, { movidoEm: null, ultimaMovimentacao: { lt: corte } }]);
  });
});
