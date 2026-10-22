import { describe, expect, it } from "vitest";
import { erroQuandoNaoHaExigencias, erroQuandoNenhumPrincipalFoiLido, MOTIVOS_SEM_REMEDIO_AUTOMATICO } from "@/lib/auditoria-acao-humana";
import { acoesHumanasDoTipo, mensagemAmigavelDoTipo, pedeAcaoHumana } from "@/lib/ia-erros";
import { decidirAposFalha } from "@/lib/auditoria-politica";
import { statusHabilitacaoDefinitivaDoErro, statusHabilitacaoDoErro } from "@/lib/habilitacao";

describe("erroQuandoNenhumPrincipalFoiLido", () => {
  it("todos os principais com o mesmo problema que só uma pessoa resolve: ação humana específica", () => {
    expect(erroQuandoNenhumPrincipalFoiLido(["protegido"])).toBe("PDF_PROTEGIDO");
    expect(erroQuandoNenhumPrincipalFoiLido(["corrompido", "protegido"])).toBe("PDF_PROTEGIDO");
    expect(erroQuandoNenhumPrincipalFoiLido(["removido"])).toBe("EDITAL_REMOVIDO");
    expect(erroQuandoNenhumPrincipalFoiLido(["login"])).toBe("LOGIN_OU_CAPTCHA");
    expect(erroQuandoNenhumPrincipalFoiLido(["pagina"])).toBe("LOGIN_OU_CAPTCHA");
    expect(erroQuandoNenhumPrincipalFoiLido(["ilegivel"])).toBe("ESCANEADO_ILEGIVEL");
  });
  it("motivos diferentes juntos: o mais estrutural manda (edital apagado explica o resto)", () => {
    expect(erroQuandoNenhumPrincipalFoiLido(["ilegivel", "removido"])).toBe("EDITAL_REMOVIDO");
    expect(erroQuandoNenhumPrincipalFoiLido(["protegido", "login"])).toBe("LOGIN_OU_CAPTCHA");
  });
  it("se algum motivo pode ser passageiro (download, demorou, formato), segue o caminho de nova tentativa", () => {
    expect(erroQuandoNenhumPrincipalFoiLido(["protegido", "download"])).toBe("ARQUIVO_ILEGIVEL");
    expect(erroQuandoNenhumPrincipalFoiLido(["demorou"])).toBe("ARQUIVO_ILEGIVEL");
    expect(erroQuandoNenhumPrincipalFoiLido(["formato"])).toBe("ARQUIVO_ILEGIVEL");
    expect(erroQuandoNenhumPrincipalFoiLido([undefined])).toBe("ARQUIVO_ILEGIVEL");
    expect(erroQuandoNenhumPrincipalFoiLido([])).toBe("ARQUIVO_ILEGIVEL");
  });
  it("lista dos motivos sem remédio automático", () => {
    for (const m of ["removido", "protegido", "corrompido", "login", "pagina", "ilegivel"]) expect(MOTIVOS_SEM_REMEDIO_AUTOMATICO.has(m)).toBe(true);
    for (const m of ["download", "demorou", "formato", "armazenamento", "ocr", "parcial"]) expect(MOTIVOS_SEM_REMEDIO_AUTOMATICO.has(m)).toBe(false);
  });
});

describe("tipos que pedem ação humana", () => {
  const humanos = ["PDF_PROTEGIDO", "EDITAL_REMOVIDO", "LOGIN_OU_CAPTCHA", "ESCANEADO_ILEGIVEL", "CUSTO_EXCEDIDO"] as const;

  it("a política manda para 'ação humana' (sem nova tentativa automática, em qualquer contagem)", () => {
    for (const t of humanos) {
      expect(pedeAcaoHumana(t)).toBe(true);
      expect(decidirAposFalha(t, 0)).toEqual({ acao: "acao_humana" });
      expect(decidirAposFalha(t, 3)).toEqual({ acao: "acao_humana" });
    }
    expect(pedeAcaoHumana("CONEXAO")).toBe(false);
    expect(pedeAcaoHumana(null)).toBe(false);
  });

  it("o selo é 'Precisa de ação' (nunca 'tentando de novo')", () => {
    for (const t of humanos) {
      expect(statusHabilitacaoDoErro(t)).toBe("PRECISA_ACAO_HUMANA");
      expect(statusHabilitacaoDefinitivaDoErro(t)).toBe("PRECISA_ACAO_HUMANA");
    }
  });

  it("cada caso tem mensagem em português simples (sem termos técnicos) e os botões certos", () => {
    for (const t of humanos) {
      const msg = mensagemAmigavelDoTipo(t);
      expect(msg.length).toBeGreaterThan(40);
      expect(msg).not.toMatch(/request_id|HTTP|exception|stack|undefined/i);
      expect(acoesHumanasDoTipo(t).length).toBeGreaterThan(0);
    }
    expect(acoesHumanasDoTipo("EDITAL_REMOVIDO")).toEqual(["enviar_arquivo"]);
    expect(acoesHumanasDoTipo("CUSTO_EXCEDIDO")).toContain("liberar_leitura");
    expect(acoesHumanasDoTipo("PDF_PROTEGIDO")).toEqual(["enviar_arquivo", "tentar_de_novo"]);
    expect(acoesHumanasDoTipo("CONEXAO")).toEqual([]);
  });
});

describe("erroQuandoNaoHaExigencias — só diz 'sem exigências' quando todos os principais foram lidos", () => {
  it("todos os principais lidos e nenhuma exigência: SEM_EXIGENCIAS", () => {
    expect(erroQuandoNaoHaExigencias([])).toBe("SEM_EXIGENCIAS");
  });
  it("só a capa abriu e o edital de verdade não: o motivo é o arquivo, não 'sem exigências'", () => {
    expect(erroQuandoNaoHaExigencias(["protegido"])).toBe("PDF_PROTEGIDO");
    expect(erroQuandoNaoHaExigencias(["formato"])).toBe("ARQUIVO_ILEGIVEL");
    expect(erroQuandoNaoHaExigencias([undefined])).toBe("ARQUIVO_ILEGIVEL");
  });
});
