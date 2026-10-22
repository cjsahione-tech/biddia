import { afterAll, describe, expect, it, vi } from "vitest";

// Regressão FIXA da auditoria de habilitação. Roda em toda execução dos testes (`npm test`), sem IA e sem banco:
//  1) 11 auditorias já concluídas (fotografia gravada em fixtures.json): o resultado recalculado com as regras de HOJE
//     tem de ser exatamente o esperado abaixo, e NUNCA pode haver "Habilitada" sem base (zero falso positivo);
//  2) os 4 editais problemáticos, como cenários feitos com os documentos reais de cada um e o comportamento esperado.
// A tabela com o resultado de cada caso aparece no fim da execução. Para atualizar a fotografia:
//   node scripts/gerar-fixtures-regressao.cjs   (somente leitura do banco)
// e, se uma expectativa mudar de propósito, edite a tabela ESPERADO abaixo — mudança de resultado nunca passa em silêncio.

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/agents/agente1-comercial", () => ({ baixarDocumentosPendentes: async () => {} }));
vi.mock("@/lib/agents/pdf-extract", () => ({ obterTextoBrutoDocumento: async () => null }));
vi.mock("@/lib/notifications", () => ({ notificarPrazosVencendo: async () => {} }));

import fixtures from "@/lib/agents/regressao/fixtures.json";
import { montarDocumentosLidos } from "@/lib/agents/auditoria-habilitacao";
import { chaveDoPedaco, dividirAoMeio, hashDoPlanoLegado, migrarProgressoLegado, planejarPedacos, type ProgressoDePedacos } from "@/lib/agents/auditoria-pedacos";
import { erroQuandoNaoHaExigencias, erroQuandoNenhumPrincipalFoiLido } from "@/lib/auditoria-acao-humana";
import { decidirAposFalha } from "@/lib/auditoria-politica";
import { calcularResultado, type SituacaoExigencia } from "@/lib/habilitacao";
import { avaliarConfianca, CATEGORIAS_DO_NUCLEO, MIN_EXIGENCIAS_CONFIAVEL } from "@/lib/habilitacao-confianca";
import { papeisDosDocumentos } from "@/lib/leitura-papel";

type Linha = { caso: string; edital: string; esperado: string; obtido: string };
const tabela: Linha[] = [];
const registrar = (caso: string, edital: string, esperado: string, obtido: string) => tabela.push({ caso, edital, esperado, obtido });

afterAll(() => {
  const linhas = tabela.map((l) => ({ ...l, resultado: l.esperado === l.obtido ? "OK" : "FALHOU" }));
  console.log("\n=== Regressão da auditoria de habilitação ===");
  console.table(linhas);
  console.log(`${linhas.filter((l) => l.resultado === "OK").length} de ${linhas.length} casos como esperado.\n`);
});

// ── 1. Auditorias já concluídas ─────────────────────────────────────────────

/** Resultado que o sistema deve dar HOJE para cada fotografia (conferido à mão contra o que o banco tem). */
const ESPERADO: Record<string, string> = {
  E01: "NAO_HABILITADA",
  E02: "HABILITADA_RESSALVAS", // 70%, 10 exigências, núcleo completo, leitura completa
  E03: "NAO_HABILITADA",
  E04: "NAO_HABILITADA",
  E05: "NAO_HABILITADA", // Pregão 031 (leitura incompleta, mas "não habilitada" já é a resposta conservadora)
  E06: "NAO_HABILITADA",
  E07: "NAO_HABILITADA",
  E08: "REVISAR_MANUALMENTE", // Chamamento 5/2026: "100%" com 4 exigências e leitura incompleta — não pode ser dado como certo
  E09: "NAO_HABILITADA",
  E10: "NAO_HABILITADA",
  E11: "NAO_HABILITADA",
};

function resultadoDeHoje(c: (typeof fixtures.casos)[number]): string {
  const linhas = c.exigencias.map((e) => ({ categoria: e.categoria, situacao: e.situacao as SituacaoExigencia, certeza: e.certeza }));
  const calc = calcularResultado({ situacoes: linhas.map((l) => l.situacao), leituraCompleta: c.leituraCompleta });
  return avaliarConfianca({ linhas, statusCalculado: calc.status }).revisar ? "REVISAR_MANUALMENTE" : calc.status;
}

describe("auditorias já concluídas (fotografia do banco)", () => {
  it("a fotografia tem as 11 auditorias esperadas", () => {
    expect(fixtures.casos.map((c) => c.chave)).toEqual(Object.keys(ESPERADO));
  });

  for (const c of fixtures.casos) {
    it(`${c.chave} — ${c.titulo}: resultado de hoje = ${ESPERADO[c.chave]}`, () => {
      const obtido = resultadoDeHoje(c);
      registrar("Resultado (auditoria concluída)", `${c.chave} ${c.titulo.slice(0, 30)}`, ESPERADO[c.chave], obtido);
      expect(obtido).toBe(ESPERADO[c.chave]);
    });
  }

  it("ZERO falso 'Habilitada': nenhum caso sai 'Habilitada' sem leitura completa, exigências suficientes e núcleo presente", () => {
    for (const c of fixtures.casos) {
      const obtido = resultadoDeHoje(c);
      if (obtido !== "HABILITADA") continue;
      const cats = new Set(c.exigencias.map((e) => e.categoria));
      expect(c.leituraCompleta).toBe(true);
      expect(c.exigencias.length).toBeGreaterThanOrEqual(MIN_EXIGENCIAS_CONFIAVEL);
      for (const n of CATEGORIAS_DO_NUCLEO) expect(cats.has(n.id)).toBe(true);
    }
    registrar("Zero falso 'Habilitada'", "todos os 11", "0 falsos", "0 falsos");
  });

  it("o que era 'Não habilitada' continua 'Não habilitada' (a mudança só endurece resultados 'bons', nunca afrouxa)", () => {
    for (const c of fixtures.casos.filter((x) => x.statusGravado === "NAO_HABILITADA")) {
      expect(resultadoDeHoje(c)).toBe("NAO_HABILITADA");
    }
  });
});

// ── 2. Os 4 editais problemáticos ───────────────────────────────────────────

const doc = (id: string, nome: string, tipo: string, categoria: string | null) => ({ id, nome, tipo, categoria });

describe("028 Republicado — só a capa abriu e o edital de verdade não", () => {
  const docs = [doc("capa", "Capa-Licitacao", "DOCUMENTO_PNCP", "EDITAL"), doc("edital", "Edital---Republicacao---Exame-de-DNA.pdf", "DOCUMENTO_PNCP", "EDITAL")];

  it("os dois arquivos são principais (ambos 'Edital')", () => {
    const p = papeisDosDocumentos(docs);
    expect([p.get("capa"), p.get("edital")]).toEqual(["principal", "principal"]);
  });

  it("sem exigências porque o edital real não abriu: o erro aponta o arquivo, nunca 'sem exigências'", () => {
    const casos: [string, string][] = [
      ["protegido", "PDF_PROTEGIDO"],
      ["ilegivel", "ESCANEADO_ILEGIVEL"],
      ["login", "LOGIN_OU_CAPTCHA"],
      ["formato", "ARQUIVO_ILEGIVEL"],
    ];
    for (const [motivo, esperado] of casos) {
      const obtido = erroQuandoNaoHaExigencias([motivo]);
      registrar("028: edital real não abriu", `motivo "${motivo}"`, esperado, obtido);
      expect(obtido).toBe(esperado);
      expect(obtido).not.toBe("SEM_EXIGENCIAS");
    }
  });

  it("leitura registrada: a capa é 'ok' e o edital real aparece como não lido (principal)", () => {
    const lidos = montarDocumentosLidos(docs, new Map([["capa", "texto da capa"]]), papeisDosDocumentos(docs), (id) => (id === "edital" ? "formato" : undefined));
    expect(lidos.find((d) => d.nome.startsWith("Edital"))).toMatchObject({ ok: false, principal: true, motivo: "formato" });
    expect(lidos.filter((d) => d.principal).every((d) => d.ok)).toBe(false);
  });
});

describe("29/2026 — edital grande (116 mil + 89 mil caracteres) que estourava o tempo e recomeçava do zero", () => {
  const linhas = (n: number, p: string) => Array.from({ length: n }, (_, i) => `${p} ${i}: o licitante deve apresentar certidão negativa de débitos e comprovar a regularidade fiscal e trabalhista.`).join("\n");
  const edital = { nome: "2 - EDITAL N 99040-2026 - EXAMES LABORATORIAIS.pdf", texto: linhas(1050, "Cláusula").slice(0, 116_574) };
  const tr = { nome: "TERMO_DE_REFERENCIA_NB0017-2026_assinado.pdf", texto: linhas(800, "Item").slice(0, 89_275) };
  const docs = [edital, tr];

  it("o plano tem vários pedaços e as chaves não mudam de uma execução para outra", () => {
    const a = planejarPedacos(docs, { tamanho: 30_000, divididos: new Set() });
    const b = planejarPedacos(docs, { tamanho: 30_000, divididos: new Set() });
    registrar("29/2026: plano estável", "pedaços", String(a.length), String(b.length));
    expect(a.length).toBeGreaterThanOrEqual(6);
    expect(b.map((p) => p.chave)).toEqual(a.map((p) => p.chave));
  });

  it("pedaço que falha 2x é dividido ao meio e NENHUM dos outros pedaços já lidos se perde", () => {
    const base = planejarPedacos(docs, { tamanho: 30_000, divididos: new Set() });
    const alvo = base[0];
    const depois = planejarPedacos(docs, { tamanho: 30_000, divididos: new Set([alvo.chave]) });
    const mantidos = base.slice(1).every((p) => depois.some((d) => d.chave === p.chave));
    registrar("29/2026: divisão preserva o já lido", "pedaços mantidos", "sim", mantidos ? "sim" : "não");
    expect(mantidos).toBe(true);
    expect(depois.length).toBe(base.length + 1);
    expect(dividirAoMeio(alvo.texto)[0].length).toBeLessThan(alvo.texto.length);
    expect(chaveDoPedaco(alvo.docNome, alvo.texto)).toBe(alvo.chave);
  });

  it("progresso antigo (formato por índice, tamanho 45 mil) é reconhecido: a leitura em andamento continua", () => {
    const planoAntigo = planejarPedacos(docs, { tamanho: 45_000, divididos: new Set() });
    const progresso: ProgressoDePedacos = { chunksTotal: planoAntigo.length, feitos: [0, 1, 2], brutas: [{ documento: "Certidão" }], plano: hashDoPlanoLegado(planoAntigo) };
    const usado = migrarProgressoLegado(progresso, docs, 30_000);
    registrar("29/2026: progresso antigo", "tamanho reaproveitado", "45000", String(usado));
    expect(usado).toBe(45_000);
    expect(progresso.feitosChaves).toHaveLength(3);
  });

  it("estourou o tempo: é falha passageira que tenta de novo (1, 5, 15 min, 1 h), nunca erro final de primeira", () => {
    const esperas = [0, 1, 2, 3].map((n) => decidirAposFalha("TEMPO_ESGOTADO", n));
    expect(esperas.every((e) => e.acao === "tentar_de_novo")).toBe(true);
    expect(decidirAposFalha("TEMPO_ESGOTADO", 4)).toEqual({ acao: "definitivo" });
  });
});

describe("Chamamento 5/2026 — o edital foi apagado do PNCP e a auditoria saiu de documentos da própria empresa", () => {
  const docs = [
    doc("edital", "EDITAL-DE-CREDENCIAMENTO_ATUALIZADO.pdf.pdf", "DOCUMENTO_PNCP", "EDITAL"),
    doc("c1", "BALANÇO PATRIMONIAL2025.pdf", "DOCUMENTO_USUARIO", "CHECKLIST"),
    doc("c2", "CNPJ.pdf", "DOCUMENTO_USUARIO", "CHECKLIST"),
    doc("c3", "Prova de regularidade fiscal perante a Fazenda Nacional.pdf", "DOCUMENTO_USUARIO", "CHECKLIST"),
    doc("c4", "contrato social são josé ULTIMA ALTERAÇÃO.pdf", "DOCUMENTO_USUARIO", "CHECKLIST"),
  ];

  it("só o edital é principal; os documentos do dossiê da empresa são apoio", () => {
    const p = papeisDosDocumentos(docs);
    expect(p.get("edital")).toBe("principal");
    for (const id of ["c1", "c2", "c3", "c4"]) expect(p.get(id)).toBe("apoio");
  });

  it("sem o edital, NÃO há resultado: edital apagado pede ação humana (enviar o PDF ou achar a versão republicada)", () => {
    const apagado = erroQuandoNenhumPrincipalFoiLido(["removido"]);
    registrar("Chamamento 5/2026: edital apagado", "tipo do erro", "EDITAL_REMOVIDO", apagado);
    expect(apagado).toBe("EDITAL_REMOVIDO");
    expect(decidirAposFalha(apagado, 0)).toEqual({ acao: "acao_humana" });
  });

  it("portal que só não respondeu (download) NÃO vira ação humana: tenta de novo sozinho", () => {
    const passageiro = erroQuandoNenhumPrincipalFoiLido(["download"]);
    expect(passageiro).toBe("ARQUIVO_ILEGIVEL");
    expect(decidirAposFalha(passageiro, 0).acao).toBe("tentar_de_novo");
  });

  it("o resultado antigo (4 exigências, 100%, leitura incompleta) hoje é 'Revisar manualmente'", () => {
    const c = fixtures.casos.find((x) => x.chave === "E08")!;
    expect(c.statusGravado).toBe("HABILITADA_RESSALVAS");
    expect(resultadoDeHoje(c)).toBe("REVISAR_MANUALMENTE");
  });
});

describe("Pregão 031/2026 — planilha de quantitativo (xlsx) enviada pelo chat não era lida nem contava", () => {
  const docs = [
    doc("edital", "Prefeitura de CAçapava.pdf", "DOCUMENTO_USUARIO", "EDITAL"),
    doc("xlsx", "Quantitativo_Exames_Cacapava.xlsx", "DOCUMENTO_USUARIO", "CORRECAO_AGENTE"),
    doc("atestado", "ATESTADO - HERCRUZ - SÃO JOSÉ.pdf", "DOCUMENTO_USUARIO", "CHECKLIST"),
  ];
  const papeis = papeisDosDocumentos(docs);

  it("a planilha de quantitativo é documento PRINCIPAL; o atestado da empresa é apoio", () => {
    registrar("Pregão 031: papel da planilha", "xlsx", "principal", papeis.get("xlsx")!);
    expect(papeis.get("xlsx")).toBe("principal");
    expect(papeis.get("atestado")).toBe("apoio");
  });

  it("planilha não lida: a leitura NÃO é completa (nunca 'Habilitada'); lida: completa, mesmo com o atestado (apoio) sem ler", () => {
    const comFalha = montarDocumentosLidos(docs, new Map([["edital", "texto do edital"], ["atestado", "x"]]), papeis, (id) => (id === "xlsx" ? "formato" : undefined));
    const completa1 = comFalha.filter((d) => d.principal).every((d) => d.ok);
    registrar("Pregão 031: planilha não lida", "leitura completa", "não", completa1 ? "sim" : "não");
    expect(completa1).toBe(false);

    const lida = montarDocumentosLidos(docs, new Map([["edital", "texto do edital"], ["xlsx", "===== PLANILHA: Itens =====\n1: Exame | 100"]]), papeis, (id) => (id === "atestado" ? "formato" : undefined));
    const completa2 = lida.filter((d) => d.principal).every((d) => d.ok);
    registrar("Pregão 031: planilha lida, atestado não", "leitura completa", "sim", completa2 ? "sim" : "não");
    expect(completa2).toBe(true);
    expect(lida.find((d) => d.nome.startsWith("ATESTADO"))).toMatchObject({ ok: false, principal: false });
  });
});
