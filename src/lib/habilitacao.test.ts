import { describe, it, expect } from "vitest";
import {
  avaliarExigencia,
  calcularResultado,
  custoEstimadoUsd,
  dataReferenciaDoEdital,
  dividirEmPedacos,
  epochNoNome,
  fingerprintDocumentos,
  inferirNaturezaPelaRazaoSocial,
  type SituacaoExigencia,
} from "@/lib/habilitacao";

// Validades vêm do banco como meia-noite UTC; a sessão, com hora em Brasília.
const val = (s: string) => new Date(`${s}T00:00:00Z`);
const sessao = new Date("2026-10-20T10:00:00-03:00");

describe("avaliarExigencia", () => {
  it("documento enviado e sem validade: atendida", () => {
    const r = avaliarExigencia({ doc: { id: "d1", validade: null }, certeza: true, dataReferencia: sessao });
    expect(r.situacao).toBe("ATENDIDA");
  });

  it("válido até o dia da sessão (inclusive): atendida", () => {
    const r = avaliarExigencia({ doc: { id: "d1", validade: val("2026-10-20") }, certeza: true, dataReferencia: sessao });
    expect(r.situacao).toBe("ATENDIDA");
  });

  it("vence antes da sessão: vencida, e avisa se foi nos 7 dias anteriores", () => {
    const perto = avaliarExigencia({ doc: { id: "d1", validade: val("2026-10-15") }, certeza: true, dataReferencia: sessao });
    expect(perto.situacao).toBe("VENCIDA");
    expect(perto.venceAntesDaSessao).toBe(true);
    expect(perto.observacao).toContain("15/10/2026");

    const limite = avaliarExigencia({ doc: { id: "d1", validade: val("2026-10-13") }, certeza: true, dataReferencia: sessao });
    expect(limite.venceAntesDaSessao).toBe(true); // 7 dias antes

    const longe = avaliarExigencia({ doc: { id: "d1", validade: val("2026-09-01") }, certeza: true, dataReferencia: sessao });
    expect(longe.situacao).toBe("VENCIDA");
    expect(longe.venceAntesDaSessao).toBe(false);
  });

  it("sem documento: não enviada; sem certeza da exigência: verificar", () => {
    expect(avaliarExigencia({ doc: null, certeza: true, dataReferencia: sessao }).situacao).toBe("NAO_ENVIADA");
    expect(avaliarExigencia({ doc: null, certeza: false, dataReferencia: sessao }).situacao).toBe("VERIFICAR");
  });

  it("documento enviado mas sem certeza de que atende: verificar (nunca atendida)", () => {
    const r = avaliarExigencia({ doc: { id: "d1", validade: null }, certeza: false, dataReferencia: sessao });
    expect(r.situacao).toBe("VERIFICAR");
    expect(r.documentoEmpresaId).toBe("d1");
  });
});

describe("calcularResultado", () => {
  const sit = (atendidas: number, pend: number): SituacaoExigencia[] => [
    ...Array<SituacaoExigencia>(atendidas).fill("ATENDIDA"),
    ...Array<SituacaoExigencia>(pend).fill("NAO_ENVIADA"),
  ];

  it("100% = habilitada", () => {
    const r = calcularResultado({ situacoes: sit(10, 0), leituraCompleta: true });
    expect(r.status).toBe("HABILITADA");
    expect(r.percentual).toBe(100);
  });

  it("70% a 99% = habilitada com ressalvas", () => {
    expect(calcularResultado({ situacoes: sit(7, 3), leituraCompleta: true }).status).toBe("HABILITADA_RESSALVAS");
    expect(calcularResultado({ situacoes: sit(99, 1), leituraCompleta: true }).status).toBe("HABILITADA_RESSALVAS");
  });

  it("abaixo de 70% = não habilitada (69,9% também)", () => {
    expect(calcularResultado({ situacoes: sit(6, 4), leituraCompleta: true }).status).toBe("NAO_HABILITADA");
    expect(calcularResultado({ situacoes: sit(0, 5), leituraCompleta: true }).status).toBe("NAO_HABILITADA");
    expect(calcularResultado({ situacoes: sit(699, 301), leituraCompleta: true }).status).toBe("NAO_HABILITADA");
  });

  it("'verificar' e 'vencida' contam como pendentes", () => {
    const r = calcularResultado({ situacoes: ["ATENDIDA", "VERIFICAR", "VENCIDA", "ATENDIDA"], leituraCompleta: true });
    expect(r.atendidas).toBe(2);
    expect(r.pendentes).toBe(2);
    expect(r.status).toBe("NAO_HABILITADA"); // 50%
  });

  it("'não se aplica' (exigência de outro tipo de empresa) fica fora da porcentagem", () => {
    const r = calcularResultado({ situacoes: ["ATENDIDA", "ATENDIDA", "NAO_SE_APLICA", "NAO_SE_APLICA", "NAO_SE_APLICA"], leituraCompleta: true });
    expect(r.total).toBe(2);
    expect(r.percentual).toBe(100);
    expect(r.status).toBe("HABILITADA");
    expect(calcularResultado({ situacoes: ["NAO_SE_APLICA"], leituraCompleta: true }).total).toBe(0);
  });

  it("leitura incompleta nunca dá 'habilitada' cheia", () => {
    expect(calcularResultado({ situacoes: sit(5, 0), leituraCompleta: false }).status).toBe("HABILITADA_RESSALVAS");
  });
});

describe("dividirEmPedacos", () => {
  it("texto curto fica inteiro", () => {
    expect(dividirEmPedacos("abc")).toEqual(["abc"]);
  });

  it("não perde nenhuma linha e respeita o tamanho", () => {
    const linhas = Array.from({ length: 5000 }, (_, i) => `Linha número ${i} com algum texto de edital`);
    const texto = linhas.join("\n");
    const pedacos = dividirEmPedacos(texto, 20_000, 1_000);
    expect(pedacos.length).toBeGreaterThan(1);
    for (const p of pedacos) expect(p.length).toBeLessThanOrEqual(20_000);
    const juntos = pedacos.join("\n");
    for (const i of [0, 1234, 2500, 4999]) expect(juntos).toContain(`Linha número ${i} `);
    // o último trecho chega até o fim do texto
    expect(pedacos[pedacos.length - 1].endsWith(linhas[linhas.length - 1])).toBe(true);
  });
});

describe("utilidades", () => {
  it("data de referência: abertura, depois encerramento, depois hoje", () => {
    const a = new Date("2026-10-20T10:00:00Z");
    const b = new Date("2026-10-25T10:00:00Z");
    expect(dataReferenciaDoEdital({ dataAberturaProposta: a, dataEncerramentoProposta: b })).toBe(a);
    expect(dataReferenciaDoEdital({ dataAberturaProposta: null, dataEncerramentoProposta: b })).toBe(b);
    const hoje = dataReferenciaDoEdital({ dataAberturaProposta: null, dataEncerramentoProposta: null });
    expect(Math.abs(hoje.getTime() - Date.now())).toBeLessThan(5_000);
  });

  it("impressão digital muda ao enviar, substituir ou remover documento", () => {
    const base = [{ id: "a", updatedAt: new Date(1000) }, { id: "b", updatedAt: new Date(2000) }];
    const f0 = fingerprintDocumentos(base);
    expect(fingerprintDocumentos([...base].reverse())).toBe(f0); // ordem não importa
    expect(fingerprintDocumentos([...base, { id: "c", updatedAt: new Date(3000) }])).not.toBe(f0);
    expect(fingerprintDocumentos([base[0], { id: "b", updatedAt: new Date(2500) }])).not.toBe(f0);
    expect(fingerprintDocumentos([base[0]])).not.toBe(f0);
  });

  it("custo estimado com os preços de lista", () => {
    // 40 mil tokens lidos no Haiku + 3 mil escritos; 6 mil lidos e 3 mil escritos no Sonnet
    const usd = custoEstimadoUsd({ haikuEntrada: 40_000, haikuSaida: 3_000, sonnetEntrada: 6_000, sonnetSaida: 3_000 });
    expect(usd).toBeCloseTo(0.04 + 0.015 + 0.018 + 0.045, 4);
  });

  it("epoch no nome do arquivo do LicitaNet", () => {
    expect(epochNoNome("196986_editais_1786333361.zip")).toBe(1786333361);
    expect(epochNoNome("edital.pdf")).toBe(0);
  });
});

describe("inferirNaturezaPelaRazaoSocial", () => {
  it("reconhece o tipo pelo nome", () => {
    expect(inferirNaturezaPelaRazaoSocial("Comercial Silva Ltda")).toContain("LTDA");
    expect(inferirNaturezaPelaRazaoSocial("Indústria Alfa S/A")).toContain("anônima");
    expect(inferirNaturezaPelaRazaoSocial("Cooperativa dos Produtores")).toBe("cooperativa");
    expect(inferirNaturezaPelaRazaoSocial("João da Silva MEI")).toContain("MEI");
    expect(inferirNaturezaPelaRazaoSocial("Padaria Estrela ME")).toContain("ME/EPP");
    expect(inferirNaturezaPelaRazaoSocial("Associação Amigos do Bairro")).toContain("sem fins lucrativos");
  });
  it("sem indicação no nome não chuta", () => {
    expect(inferirNaturezaPelaRazaoSocial("Empresa Teste Habilitacao")).toBeNull();
    expect(inferirNaturezaPelaRazaoSocial("Mesa e Cadeira Comercio")).toBeNull(); // "ME" dentro de palavra não conta
  });
});
