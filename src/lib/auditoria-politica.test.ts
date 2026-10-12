import { describe, it, expect } from "vitest";
import {
  decidirAposFalha,
  ESPERAS_RETENTATIVA_MS,
  LIMITE_AUDITORIAS_SIMULTANEAS,
  MAX_CONTINUACOES_NA_CADEIA,
  MAX_TENTATIVAS_AUTOMATICAS,
} from "@/lib/auditoria-politica";
import { mensagemDefinitivaDoTipo, mensagemDeRetentativaDoTipo } from "@/lib/ia-erros";
import { statusHabilitacaoDefinitivaDoErro, statusHabilitacaoDoErro } from "@/lib/habilitacao";

describe("decidirAposFalha — o que fazer quando uma auditoria falha", () => {
  it("saldo ou chave: guarda e espera a IA voltar (não conta tentativa nem repete)", () => {
    expect(decidirAposFalha("SALDO_INSUFICIENTE", 0)).toEqual({ acao: "aguardar_ia" });
    expect(decidirAposFalha("CHAVE_INVALIDA", 2)).toEqual({ acao: "aguardar_ia" });
  });

  it("erro passageiro: tenta de novo com espera crescente, até o limite", () => {
    for (const tipo of ["LIMITE_TAXA", "SOBRECARGA", "SERVICO_IA", "CONEXAO", "TEMPO_ESGOTADO", "RESPOSTA_INVALIDA", "ARQUIVO_ILEGIVEL"] as const) {
      expect(decidirAposFalha(tipo, 0)).toEqual({ acao: "tentar_de_novo", esperaMs: ESPERAS_RETENTATIVA_MS[0] });
      expect(decidirAposFalha(tipo, 1)).toEqual({ acao: "tentar_de_novo", esperaMs: ESPERAS_RETENTATIVA_MS[1] });
      expect(decidirAposFalha(tipo, MAX_TENTATIVAS_AUTOMATICAS)).toEqual({ acao: "definitivo" });
    }
    expect(ESPERAS_RETENTATIVA_MS[1]).toBeGreaterThan(ESPERAS_RETENTATIVA_MS[0]);
  });

  it("erro que repetir não resolve: vai direto para o erro final", () => {
    for (const tipo of ["SEM_DOCUMENTO", "EDITAL_GRANDE", "SEM_EXIGENCIAS", "DESCONHECIDO"] as const) {
      expect(decidirAposFalha(tipo, 0)).toEqual({ acao: "definitivo" });
    }
  });
});

describe("limites da fila e da cadeia", () => {
  it("valores iniciais combinados (fáceis de mudar em auditoria-politica.ts)", () => {
    expect(LIMITE_AUDITORIAS_SIMULTANEAS).toBe(3);
    expect(MAX_TENTATIVAS_AUTOMATICAS).toBe(2);
    // A Vercel recusa cadeias com mais de 4 saltos entre funções: 1 execução + 3 continuações.
    expect(MAX_CONTINUACOES_NA_CADEIA).toBe(3);
  });
});

describe("textos e selos", () => {
  it("nova tentativa agendada x erro final usam textos diferentes e nunca vazam detalhe técnico", () => {
    for (const tipo of ["TEMPO_ESGOTADO", "LIMITE_TAXA", "RESPOSTA_INVALIDA", "ARQUIVO_ILEGIVEL"] as const) {
      expect(mensagemDeRetentativaDoTipo(tipo)).not.toBe(mensagemDefinitivaDoTipo(tipo));
      expect(mensagemDeRetentativaDoTipo(tipo) + mensagemDefinitivaDoTipo(tipo)).not.toMatch(/request_id|req_|credit|anthropic/i);
    }
    expect(mensagemDefinitivaDoTipo("TEMPO_ESGOTADO")).toMatch(/Tentar novamente/);
  });

  it("selo enquanto tenta de novo x selo no erro final", () => {
    expect(statusHabilitacaoDoErro("TEMPO_ESGOTADO")).toBe("TEMPO_ESGOTADO");
    expect(statusHabilitacaoDefinitivaDoErro("TEMPO_ESGOTADO")).toBe("ERRO"); // nada de "tentando de novo" no final
    expect(statusHabilitacaoDoErro("SOBRECARGA")).toBe("AGUARDANDO_IA");
    expect(statusHabilitacaoDefinitivaDoErro("SOBRECARGA")).toBe("ERRO");
    expect(statusHabilitacaoDefinitivaDoErro("ARQUIVO_ILEGIVEL")).toBe("ARQUIVO_ILEGIVEL");
  });
});
