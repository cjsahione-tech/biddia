import { describe, expect, it } from "vitest";
import { diasAte, iniciais, mesmoDiaBrasilia, primeiroNome, rotuloPrazo, saudacao } from "@/lib/painel-util";

describe("visual de celular: textos", () => {
  it("primeiro nome e iniciais, mesmo com nome em maiúsculas ou vazio", () => {
    expect(primeiroNome("CARLOS JOSE SAHIONE")).toBe("Carlos");
    expect(primeiroNome("  ana  maria ")).toBe("Ana");
    expect(primeiroNome(null)).toBe("");
    expect(iniciais("lucas rubem")).toBe("L");
    expect(iniciais("")).toBe("?");
  });
  it("saudação pela hora de Brasília", () => {
    expect(saudacao(new Date("2026-10-20T12:00:00Z"))).toBe("Bom dia"); // 09h BRT
    expect(saudacao(new Date("2026-10-20T16:00:00Z"))).toBe("Boa tarde"); // 13h BRT
    expect(saudacao(new Date("2026-10-20T23:00:00Z"))).toBe("Boa noite"); // 20h BRT
  });
  it("prazo: hoje, amanhã, em N dias (urgente até 3), encerrado e sem data", () => {
    const agora = new Date("2026-10-20T12:00:00Z");
    const em = (h: number) => new Date(agora.getTime() + h * 3_600_000).toISOString();
    expect(rotuloPrazo(em(2), agora)).toEqual({ texto: "Encerra hoje", tom: "urgente" });
    expect(rotuloPrazo(em(30), agora)).toEqual({ texto: "Encerra amanhã", tom: "urgente" });
    expect(rotuloPrazo(em(24 * 5 - 1), agora)).toEqual({ texto: "Encerra em 5 dias", tom: "normal" });
    expect(rotuloPrazo(em(24 * 3 - 1), agora).tom).toBe("urgente");
    expect(rotuloPrazo(em(-48), agora)).toEqual({ texto: "Encerrado", tom: "encerrado" });
    expect(rotuloPrazo(null, agora)).toEqual({ texto: "Sem data", tom: "semData" });
    expect(diasAte("lixo")).toBeNull();
  });
  it("'hoje' vale pelo dia de Brasília, não pelo UTC", () => {
    const agora = new Date("2026-10-21T01:30:00Z"); // ainda 20/10 22h30 em Brasília
    expect(mesmoDiaBrasilia("2026-10-20T15:00:00Z", agora)).toBe(true);
    expect(mesmoDiaBrasilia("2026-10-21T03:30:00Z", agora)).toBe(false);
  });
});
