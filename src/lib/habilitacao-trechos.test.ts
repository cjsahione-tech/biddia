import { describe, it, expect } from "vitest";
import { densidadeDeHabilitacao, LIMITE_TEXTO_INTEIRO, selecionarTrechosDeHabilitacao } from "@/lib/habilitacao-trechos";

const enchimento = (n: number, tema: string) =>
  Array.from({ length: n }, (_, i) => `${tema} linha ${i}: texto corrido sobre ${tema} sem nada a ver com o assunto principal.`).join("\n");

describe("selecionarTrechosDeHabilitacao", () => {
  it("documento curto passa inteiro (não há o que economizar)", () => {
    const t = "[Pág. 1]\nCertidão negativa de débitos federais.";
    const r = selecionarTrechosDeHabilitacao(t);
    expect(r.inteiro).toBe(true);
    expect(r.texto).toBe(t);
  });

  it("documento longo: mantém a seção de habilitação e descarta o resto", () => {
    const texto = [
      "[Pág. 1]",
      enchimento(400, "objeto da contratação e descrição dos itens"),
      "[Pág. 20]",
      "DA HABILITAÇÃO",
      "8.2.1 Certidão Negativa de Débitos relativos aos Tributos Federais e à Dívida Ativa da União;",
      "8.2.2 Certificado de Regularidade do FGTS (CRF);",
      "8.3 Balanço patrimonial do último exercício social, com índices de liquidez maiores que 1,00;",
      "[Pág. 30]",
      enchimento(400, "penalidades e sanções administrativas aplicáveis"),
    ].join("\n");
    expect(texto.length).toBeGreaterThan(LIMITE_TEXTO_INTEIRO);

    const r = selecionarTrechosDeHabilitacao(texto);
    expect(r.inteiro).toBe(false);
    expect(r.selecionado).toBeLessThan(r.original * 0.5);
    for (const exigencia of ["Dívida Ativa da União", "Certificado de Regularidade do FGTS", "índices de liquidez"]) {
      expect(r.texto).toContain(exigencia);
    }
    expect(r.texto).toContain("[Pág. 20]"); // a página continua citável
    expect(r.texto).not.toContain("objeto da contratação e descrição dos itens linha 100");
  });

  it("leva o contexto vizinho: item de lista logo depois do que tem o termo", () => {
    const texto = [
      "[Pág. 5]",
      enchimento(300, "cláusula de pagamento"),
      "O licitante deverá apresentar os seguintes documentos de qualificação técnica:",
      "a) atestado de capacidade técnica emitido por pessoa jurídica;",
      "b) registro da empresa no conselho profissional competente;",
      "c) indicação do responsável técnico.",
      enchimento(300, "cláusula de reajuste"),
    ].join("\n");
    const r = selecionarTrechosDeHabilitacao(texto);
    expect(r.texto).toContain("indicação do responsável técnico");
    expect(r.texto).toContain("registro da empresa no conselho profissional");
  });

  it("não considera 'registro de preços' (termo genérico) como habilitação", () => {
    const texto = enchimento(600, "ata de registro de preços e vigência da ata");
    const r = selecionarTrechosDeHabilitacao(texto);
    expect(r.selecionado).toBeLessThan(r.original * 0.2);
  });
});

describe("densidadeDeHabilitacao", () => {
  it("trecho de habilitação tem densidade maior que trecho de pagamento", () => {
    const hab = "Certidão negativa de débitos, declaração, atestado de capacidade técnica e balanço patrimonial.";
    const pag = "O pagamento será efetuado em até 30 dias após o recebimento definitivo do objeto.";
    expect(densidadeDeHabilitacao(hab)).toBeGreaterThan(densidadeDeHabilitacao(pag));
    expect(densidadeDeHabilitacao("")).toBe(0);
  });
});
