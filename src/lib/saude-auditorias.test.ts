import { describe, expect, it } from "vitest";
import { LIMITE_TRAVADA_AUDITORIA_MS, resumirSaudeAuditorias, type LinhaAuditoria, type TentativaLog } from "@/lib/saude-auditorias";

const agora = new Date("2026-10-22T12:00:00Z");
const minAtras = (m: number) => new Date(agora.getTime() - m * 60_000);

const linha = (over: Partial<LinhaAuditoria> = {}): LinhaAuditoria => ({
  estado: "CONCLUIDA",
  statusEdital: "HABILITADA",
  leituraCompleta: true,
  retentativaAgendada: false,
  erroTipo: null,
  custoUsd: 0.2,
  iniciadaEm: minAtras(30),
  concluidaEm: minAtras(28),
  updatedAt: minAtras(28),
  ...over,
});

describe("resumirSaudeAuditorias", () => {
  it("separa completas, parciais, revisar manualmente, precisa de ação, em andamento, erro final e travadas", () => {
    const r = resumirSaudeAuditorias(
      [
        linha(),
        linha({ statusEdital: "NAO_HABILITADA" }),
        linha({ leituraCompleta: false, statusEdital: "HABILITADA_RESSALVAS" }),
        linha({ statusEdital: "REVISAR_MANUALMENTE" }),
        linha({ estado: "ERRO", statusEdital: "PRECISA_ACAO_HUMANA", erroTipo: "PDF_PROTEGIDO", concluidaEm: null }),
        linha({ estado: "RODANDO", statusEdital: "AUDITANDO", concluidaEm: null, updatedAt: minAtras(1) }),
        linha({ estado: "ERRO", statusEdital: "AUDITANDO", retentativaAgendada: true, concluidaEm: null }),
        linha({ estado: "AGUARDANDO_SALDO", statusEdital: "AGUARDANDO_IA", concluidaEm: null }),
        linha({ estado: "ERRO", statusEdital: "ERRO", erroTipo: "DESCONHECIDO", concluidaEm: null }),
        linha({ estado: "RODANDO", statusEdital: "AUDITANDO", concluidaEm: null, updatedAt: minAtras(11) }),
      ],
      [],
      { agora, tetoCustoUsd: 1.5 }
    );
    expect(r).toMatchObject({ total: 10, completas: 2, parciais: 1, revisarManualmente: 1, precisaAcao: 1, emAndamento: 3, erroFinal: 1, travadas: 1 });
  });

  it("taxa 'terminou sozinha': resultado ou aviso claro sobre tudo que já terminou (erro sem explicação e travada contam contra)", () => {
    const r = resumirSaudeAuditorias(
      [linha(), linha(), linha(), linha({ estado: "ERRO", statusEdital: "ERRO", concluidaEm: null })],
      [],
      { agora, tetoCustoUsd: 1.5 }
    );
    expect(r.taxaSozinha).toBeCloseTo(0.75);
    expect(resumirSaudeAuditorias([linha({ estado: "RODANDO", concluidaEm: null, updatedAt: minAtras(1) })], [], { agora, tetoCustoUsd: 1.5 }).taxaSozinha).toBeNull();
    expect(LIMITE_TRAVADA_AUDITORIA_MS).toBe(600_000);
  });

  it("tempo médio e mediana (a mediana não se deixa levar por uma auditoria que ficou dias parada)", () => {
    const r = resumirSaudeAuditorias(
      [linha({ iniciadaEm: minAtras(12), concluidaEm: minAtras(10) }), linha({ iniciadaEm: minAtras(25), concluidaEm: minAtras(20) }), linha({ iniciadaEm: minAtras(3000), concluidaEm: minAtras(5) })],
      [],
      { agora, tetoCustoUsd: 1.5 }
    );
    expect(r.tempo.medianaMin).toBe(5);
    expect(r.tempo.mediaMin).toBeGreaterThan(900);
  });

  it("custo: total, médio, máximo e quantas passaram do teto", () => {
    const r = resumirSaudeAuditorias([linha({ custoUsd: 0.1 }), linha({ custoUsd: 0.3 }), linha({ custoUsd: 1.7 }), linha({ custoUsd: 0 })], [], { agora, tetoCustoUsd: 1.5 });
    expect(r.custo).toEqual({ totalUsd: 2.1, medioUsd: 0.7, maximoUsd: 1.7, acimaDoTeto: 1 });
    expect(resumirSaudeAuditorias([], [], { agora, tetoCustoUsd: 1.5 }).custo).toEqual({ totalUsd: 0, medioUsd: null, maximoUsd: null, acimaDoTeto: 0 });
  });

  it("erros mais comuns e tentativas por resultado/método vêm do registro de tentativas", () => {
    const t = (resultado: string, tipoErro: string | null, metodo: string | null = "texto"): TentativaLog => ({ resultado, tipoErro, metodo, duracaoMs: 1000, custoUsd: 0 });
    const r = resumirSaudeAuditorias([], [t("retentativa", "CONEXAO"), t("retentativa", "CONEXAO"), t("definitivo", "SOBRECARGA"), t("concluida", null, "texto+ocr")], { agora, tetoCustoUsd: 1.5 });
    expect(r.errosComuns).toEqual([{ tipo: "CONEXAO", n: 2 }, { tipo: "SOBRECARGA", n: 1 }]);
    expect(r.tentativas.total).toBe(4);
    expect(r.tentativas.porResultado[0]).toEqual({ resultado: "retentativa", n: 2 });
    expect(r.tentativas.porMetodo).toEqual([{ metodo: "texto", n: 3 }, { metodo: "texto+ocr", n: 1 }]);
  });
});
