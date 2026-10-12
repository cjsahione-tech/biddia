import { describe, it, expect } from "vitest";
import {
  classificarErro,
  descreverErro,
  ehErroTransiente,
  ErroTipado,
  tipoDeMensagemAntiga,
} from "@/lib/ia-erros";

// Formato real do erro que a API da Anthropic devolve quando o saldo acaba (visto em produção).
const MSG_SALDO =
  '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."},"request_id":"req_011CZabc123"}';

function erroApi(status: number, msg: string) {
  return Object.assign(new Error(msg), { status });
}

describe("classificarErro", () => {
  it("reconhece saldo insuficiente e nunca expõe request_id ao usuário", () => {
    const c = classificarErro(erroApi(400, MSG_SALDO));
    expect(c.tipo).toBe("SALDO_INSUFICIENTE");
    expect(c.pausaIA).toBe(true);
    expect(c.mensagemUsuario).not.toMatch(/request_id|req_|credit balance|console\.anthropic/i);
    // O detalhe técnico guarda tudo, para suporte
    expect(c.detalheTecnico).toContain("req_011CZabc123");
  });

  it("dá o aviso com o caminho do console só para o administrador", () => {
    const c = classificarErro(erroApi(400, MSG_SALDO));
    expect(c.mensagemAdmin).toContain("console.anthropic.com");
    expect(c.mensagemAdmin).toContain("Plans & Billing");
  });

  it("chave recusada (401/403) pausa a IA e avisa o administrador", () => {
    const c = classificarErro(erroApi(401, "401 invalid x-api-key"));
    expect(c.tipo).toBe("CHAVE_INVALIDA");
    expect(c.pausaIA).toBe(true);
    expect(c.mensagemAdmin).toMatch(/ANTHROPIC_API_KEY/);
    expect(c.mensagemUsuario).not.toMatch(/x-api-key|401/);
  });

  it("429, 529 e 5xx são passageiros e não pausam a IA", () => {
    expect(classificarErro(erroApi(429, "rate_limit_error")).tipo).toBe("LIMITE_TAXA");
    expect(classificarErro(erroApi(529, "overloaded_error")).tipo).toBe("SOBRECARGA");
    expect(classificarErro(erroApi(503, "service unavailable")).tipo).toBe("SERVICO_IA");
    for (const s of [429, 529, 503]) {
      const c = classificarErro(erroApi(s, "x"));
      expect(c.transiente).toBe(true);
      expect(c.pausaIA).toBe(false);
      expect(c.mensagemAdmin).toBeNull();
    }
  });

  it("erros de edital vêm tipados e amigáveis", () => {
    expect(classificarErro(new ErroTipado("ARQUIVO_ILEGIVEL", "interno")).mensagemUsuario).toMatch(/ler os arquivos/);
    expect(classificarErro(new ErroTipado("EDITAL_GRANDE", "interno")).tipo).toBe("EDITAL_GRANDE");
  });

  it("resposta fora do formato e tempo esgotado são passageiros", () => {
    expect(classificarErro(new Error("Não foi possível interpretar a resposta da IA como JSON.")).tipo).toBe("RESPOSTA_INVALIDA");
    expect(classificarErro(new Error("Request timed out")).tipo).toBe("TEMPO_ESGOTADO");
    expect(classificarErro(new Error("fetch failed")).tipo).toBe("CONEXAO");
  });
});

describe("ehErroTransiente com erro tipado", () => {
  it("saldo e chave nunca são repetidos na hora (o disjuntor cuida)", () => {
    expect(ehErroTransiente(new ErroTipado("SALDO_INSUFICIENTE", "x"))).toBe(false);
    expect(ehErroTransiente(new ErroTipado("CHAVE_INVALIDA", "x"))).toBe(false);
    expect(ehErroTransiente(new ErroTipado("SOBRECARGA", "x"))).toBe(true);
    expect(ehErroTransiente(new ErroTipado("ARQUIVO_ILEGIVEL", "x"))).toBe(false);
  });
});

describe("tipoDeMensagemAntiga (linhas gravadas antes da classificação)", () => {
  it("reconhece a mensagem crua de saldo guardada no banco", () => {
    expect(tipoDeMensagemAntiga(MSG_SALDO)).toBe("SALDO_INSUFICIENTE");
  });
  it("reconhece as mensagens antigas de edital", () => {
    expect(tipoDeMensagemAntiga("Não foi possível ler nenhum documento deste edital (arquivos não baixaram)")).toBe("ARQUIVO_ILEGIVEL");
    expect(tipoDeMensagemAntiga("O edital é grande demais para ser lido em uma auditoria.")).toBe("EDITAL_GRANDE");
  });
});

describe("descreverErro", () => {
  it("não vaza a mensagem crua de saldo nem de erros desconhecidos", () => {
    expect(descreverErro(erroApi(400, MSG_SALDO))).not.toMatch(/request_id|credit balance|req_/i);
    expect(descreverErro(new Error('{"type":"error","request_id":"req_zzz999"}'))).not.toMatch(/req_zzz999|request_id/);
  });
  it("mantém mensagens curtas e nossas", () => {
    expect(descreverErro(new Error("ANTHROPIC_API_KEY não configurada."))).toContain("ANTHROPIC_API_KEY");
  });
});
