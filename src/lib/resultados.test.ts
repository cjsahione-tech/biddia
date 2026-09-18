import { describe, expect, it } from "vitest";
import {
  montarResultados,
  filtrosDaQueryString,
  filtrosParaQueryString,
  FILTROS_PADRAO,
  type EditalParaResultados,
} from "@/lib/resultados";

function edital(overrides: Partial<EditalParaResultados>): EditalParaResultados {
  return {
    id: Math.random().toString(36).slice(2),
    titulo: "Pregão eletrônico",
    fonte: "PNCP",
    uf: "ES",
    orgaoNome: "Prefeitura de Vitória",
    tipoObjeto: "SERVICO",
    etapaKanban: "OPORTUNIDADE",
    valorGlobal: 100_000,
    orcamentoSigiloso: false,
    createdAt: "2026-01-10T12:00:00.000Z",
    decidedAt: null,
    proposalValor: null,
    ...overrides,
  };
}

describe("montarResultados", () => {
  it("classifica ganhos, perdidos e em andamento e calcula a taxa de conversão só sobre os decididos", () => {
    const editais = [
      edital({ etapaKanban: "ACEITA", valorGlobal: 100_000 }),
      edital({ etapaKanban: "EM_CONTRATO", valorGlobal: 200_000 }),
      edital({ etapaKanban: "SEM_PROPOSTAS", valorGlobal: 50_000 }),
      edital({ etapaKanban: "OPORTUNIDADE", valorGlobal: 300_000 }),
      edital({ etapaKanban: "QUALIFICACAO", valorGlobal: 400_000 }),
    ];

    const r = montarResultados(editais, FILTROS_PADRAO);

    expect(r.ganhos).toBe(2);
    expect(r.perdidos).toBe(1);
    expect(r.emAndamento).toBe(2);
    // taxaConversao = ganhos / (ganhos + perdidos) = 2 / 3
    expect(r.taxaConversao).toBeCloseTo(2 / 3);
    expect(r.valorGanho).toBe(300_000);
    expect(r.ticketMedioGanho).toBe(150_000);
    expect(r.valorEmDisputa).toBe(700_000);
    expect(r.valorPerdido).toBe(50_000);
  });

  it("sem nenhum edital decidido, a taxa de conversão fica null em vez de dividir por zero", () => {
    const editais = [edital({ etapaKanban: "OPORTUNIDADE" }), edital({ etapaKanban: "QUALIFICACAO" })];
    const r = montarResultados(editais, FILTROS_PADRAO);
    expect(r.taxaConversao).toBeNull();
    expect(r.ticketMedioGanho).toBeNull();
  });

  it("usa o valor da proposta como fallback quando o edital não tem valorGlobal publicado (ex: orçamento sigiloso)", () => {
    const editais = [
      edital({ etapaKanban: "ACEITA", valorGlobal: null, orcamentoSigiloso: true, proposalValor: 80_000 }),
    ];
    const r = montarResultados(editais, FILTROS_PADRAO);
    expect(r.valorGanho).toBe(80_000);
    expect(r.qtdSigilosos).toBe(1);
  });

  it("filtra por período (createdAt) de forma inclusiva nos dois extremos", () => {
    const editais = [
      edital({ createdAt: "2026-01-05T10:00:00.000Z" }),
      edital({ createdAt: "2026-01-15T10:00:00.000Z" }),
      edital({ createdAt: "2026-01-25T10:00:00.000Z" }),
    ];
    const r = montarResultados(editais, { ...FILTROS_PADRAO, de: "2026-01-10", ate: "2026-01-20" });
    expect(r.totalFiltrado).toBe(1);
    expect(r.totalGeral).toBe(3);
  });

  it("filtra por situação, portal, UF e tipo de objeto", () => {
    const editais = [
      edital({ etapaKanban: "ACEITA", fonte: "PNCP", uf: "ES", tipoObjeto: "SERVICO" }),
      edital({ etapaKanban: "OPORTUNIDADE", fonte: "LICITANET", uf: "SP", tipoObjeto: "BEM" }),
      edital({ etapaKanban: "SEM_PROPOSTAS", fonte: "PNCP", uf: "ES", tipoObjeto: null }),
    ];

    expect(montarResultados(editais, { ...FILTROS_PADRAO, situacao: "GANHOS" }).totalFiltrado).toBe(1);
    expect(montarResultados(editais, { ...FILTROS_PADRAO, fonte: "PNCP" }).totalFiltrado).toBe(2);
    expect(montarResultados(editais, { ...FILTROS_PADRAO, uf: "SP" }).totalFiltrado).toBe(1);
    expect(montarResultados(editais, { ...FILTROS_PADRAO, tipoObjeto: "NAO_CLASSIFICADO" }).totalFiltrado).toBe(1);
  });

  it("agrupa por portal, UF, tipo de objeto e órgão com quantidade e valor somado", () => {
    const editais = [
      edital({ fonte: "PNCP", uf: "ES", orgaoNome: "Prefeitura A", valorGlobal: 100 }),
      edital({ fonte: "PNCP", uf: "ES", orgaoNome: "Prefeitura A", valorGlobal: 200 }),
      edital({ fonte: "LICITANET", uf: "SP", orgaoNome: "Prefeitura B", valorGlobal: 300 }),
    ];
    const r = montarResultados(editais, FILTROS_PADRAO);

    const pncp = r.porPortal.find((p) => p.chave === "PNCP");
    expect(pncp?.quantidade).toBe(2);
    expect(pncp?.valor).toBe(300);

    const orgaoA = r.porOrgao.find((o) => o.chave === "Prefeitura A");
    expect(orgaoA?.quantidade).toBe(2);
  });

  it("agrupa 'Outros' quando UF/órgão passam do teto de categorias principais", () => {
    const ufs = ["ES", "SP", "RJ", "MG", "BA", "PR", "RS", "SC", "GO", "PE"]; // 10 UFs, teto é 8
    const editais = ufs.map((uf) => edital({ uf }));
    const r = montarResultados(editais, FILTROS_PADRAO);

    expect(r.porUf).toHaveLength(9); // 8 principais + "Outros"
    const outros = r.porUf.find((u) => u.chave === "OUTROS");
    expect(outros?.quantidade).toBe(2);
  });

  it("computa o tempo médio de decisão só sobre editais com decidedAt preenchido", () => {
    const editais = [
      edital({ createdAt: "2026-01-01T00:00:00.000Z", decidedAt: "2026-01-11T00:00:00.000Z" }), // 10 dias
      edital({ createdAt: "2026-01-01T00:00:00.000Z", decidedAt: "2026-01-21T00:00:00.000Z" }), // 20 dias
      edital({ createdAt: "2026-01-01T00:00:00.000Z", decidedAt: null }),
    ];
    const r = montarResultados(editais, FILTROS_PADRAO);
    expect(r.tempoMedioDecisaoDias).toBeCloseTo(15);
  });

  it("monta a evolução mensal preenchendo os meses sem editais com zero", () => {
    const editais = [
      edital({ createdAt: "2026-01-05T00:00:00.000Z", etapaKanban: "ACEITA" }),
      edital({ createdAt: "2026-03-05T00:00:00.000Z", etapaKanban: "SEM_PROPOSTAS" }),
    ];
    const r = montarResultados(editais, FILTROS_PADRAO);
    expect(r.evolucaoMensal.map((p) => p.mes)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(r.evolucaoMensal[1].captados).toBe(0);
    expect(r.evolucaoMensal[0].ganhos).toBe(1);
    expect(r.evolucaoMensal[2].perdidos).toBe(1);
  });

  it("lista as opções de filtro (UF/portal) a partir do conjunto SEM filtro, não do filtrado", () => {
    const editais = [edital({ uf: "ES", fonte: "PNCP" }), edital({ uf: "SP", fonte: "LICITANET" })];
    const r = montarResultados(editais, { ...FILTROS_PADRAO, uf: "ES" });
    expect(r.opcoesFiltro.ufs).toEqual(["ES", "SP"]);
    expect(r.opcoesFiltro.fontes).toEqual(["LICITANET", "PNCP"]);
  });
});

describe("filtrosParaQueryString / filtrosDaQueryString (ida e volta)", () => {
  it("filtros padrão viram uma query string vazia", () => {
    expect(filtrosParaQueryString(FILTROS_PADRAO)).toBe("");
  });

  it("round-trip preserva todos os filtros não-padrão", () => {
    const filtros = { de: "2026-01-01", ate: "2026-06-30", situacao: "GANHOS" as const, fonte: "PNCP", uf: "ES", tipoObjeto: "SERVICO" };
    const query = filtrosParaQueryString(filtros);
    const voltaram = filtrosDaQueryString(new URLSearchParams(query));
    expect(voltaram).toEqual(filtros);
  });

  it("uma situação inválida na query string cai no padrão em vez de quebrar", () => {
    const r = filtrosDaQueryString(new URLSearchParams("situacao=LIXO"));
    expect(r.situacao).toBe("TODOS");
  });
});
