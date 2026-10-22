import { describe, expect, it } from "vitest";
import { corrigirSeloPreso } from "@/lib/auditoria-selos";

describe("corrigirSeloPreso — nada fica 'processando' para sempre", () => {
  it("selo de andamento sem auditoria por trás: coloca na fila", () => {
    for (const statusEdital of ["AUDITANDO", "NA_FILA", "AGUARDANDO_IA", "TEMPO_ESGOTADO"]) {
      expect(corrigirSeloPreso({ statusEdital, auditoria: null })).toEqual({ acao: "enfileirar" });
    }
  });

  it("auditoria em erro final mas o selo diz 'Auditando…': mostra o erro final", () => {
    const r = corrigirSeloPreso({ statusEdital: "AUDITANDO", auditoria: { estado: "ERRO", erroTipo: "ARQUIVO_ILEGIVEL", proximaTentativaEm: null } });
    expect(r).toEqual({ acao: "definir", status: "ARQUIVO_ILEGIVEL" });
    const r2 = corrigirSeloPreso({ statusEdital: "TEMPO_ESGOTADO", auditoria: { estado: "ERRO", erroTipo: "TEMPO_ESGOTADO", proximaTentativaEm: null } });
    expect(r2).toEqual({ acao: "definir", status: "ERRO" });
  });

  it("nova tentativa agendada, fila, rodando ou guardada: não mexe", () => {
    const base = { statusEdital: "NA_FILA" };
    expect(corrigirSeloPreso({ ...base, auditoria: { estado: "ERRO", erroTipo: "CONEXAO", proximaTentativaEm: new Date() } })).toBeNull();
    for (const estado of ["NA_FILA", "RODANDO", "AGUARDANDO_SALDO", "INTERROMPIDA"]) {
      expect(corrigirSeloPreso({ ...base, auditoria: { estado, erroTipo: null, proximaTentativaEm: null } })).toBeNull();
    }
  });

  it("selos de resultado ou de erro nunca são mexidos", () => {
    for (const statusEdital of ["HABILITADA", "HABILITADA_RESSALVAS", "NAO_HABILITADA", "REVISAR_MANUALMENTE", "ERRO", "ARQUIVO_ILEGIVEL", "AGUARDANDO"]) {
      expect(corrigirSeloPreso({ statusEdital, auditoria: null })).toBeNull();
    }
  });
});
