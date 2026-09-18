import { NextResponse } from "next/server";
import { requireCompany } from "@/lib/api-utils";
import { montarResultados, filtrosDaQueryString, buscarEditaisParaResultados, TIPO_OBJETO_LABEL } from "@/lib/resultados";
import { gerarPdfRelatorio, type SecaoRelatorio } from "@/lib/agents/pdf";
import { formatBRL, formatDate } from "@/lib/format";

const SITUACAO_LABEL: Record<string, string> = {
  TODOS: "Todas",
  ANDAMENTO: "Em andamento",
  GANHOS: "Ganhos",
  PERDIDOS: "Perdidos",
};

function formatPercentual(v: number | null): string {
  return v == null ? "—" : `${(v * 100).toFixed(1)}%`;
}

function formatDias(v: number | null): string {
  return v == null ? "—" : `${v.toFixed(0)} dia(s)`;
}

export async function GET(req: Request) {
  const { company, error } = await requireCompany();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const filtros = filtrosDaQueryString(searchParams);

  const editais = await buscarEditaisParaResultados(company!.id);
  const r = montarResultados(editais, filtros);

  const secoes: SecaoRelatorio[] = [];

  secoes.push({
    tipo: "campos",
    titulo: "Filtros aplicados",
    campos: [
      { label: "Período", valor: filtros.de || filtros.ate ? `${filtros.de ?? "início"} a ${filtros.ate ?? "hoje"}` : "Todo o histórico" },
      { label: "Situação", valor: SITUACAO_LABEL[filtros.situacao] ?? filtros.situacao },
      { label: "Portal", valor: filtros.fonte ?? "Todos" },
      { label: "Estado (UF)", valor: filtros.uf ?? "Todos" },
      { label: "Tipo de objeto", valor: filtros.tipoObjeto ? (TIPO_OBJETO_LABEL[filtros.tipoObjeto] ?? filtros.tipoObjeto) : "Todos" },
    ],
  });

  secoes.push({
    tipo: "campos",
    titulo: "Resumo geral",
    campos: [
      { label: "Editais no filtro", valor: `${r.totalFiltrado} de ${r.totalGeral} no total` },
      { label: "Ganhos", valor: `${r.ganhos}` },
      { label: "Perdidos", valor: `${r.perdidos}` },
      { label: "Em andamento", valor: `${r.emAndamento}` },
      { label: "Taxa de conversão (ganhos / decididos)", valor: formatPercentual(r.taxaConversao) },
      { label: "Tempo médio até a decisão", valor: formatDias(r.tempoMedioDecisaoDias) },
    ],
  });

  secoes.push({
    tipo: "campos",
    titulo: "Resultado financeiro",
    campos: [
      { label: "Valor total ganho", valor: `${formatBRL(r.valorGanho)} (${r.qtdGanhosComValor} edital(is) com valor conhecido)` },
      { label: "Ticket médio ganho", valor: r.ticketMedioGanho != null ? formatBRL(r.ticketMedioGanho) : "—" },
      { label: "Valor em disputa (em andamento)", valor: `${formatBRL(r.valorEmDisputa)} (${r.qtdEmDisputaComValor} edital(is) com valor conhecido)` },
      { label: "Valor perdido", valor: formatBRL(r.valorPerdido) },
      ...(r.qtdSigilosos > 0
        ? [{ label: "Orçamento sigiloso", valor: `${r.qtdSigilosos} edital(is) sem valor publicado pelo órgão — somas acima podem estar subestimadas` }]
        : []),
    ],
  });

  const funilComDados = r.funil.filter((f) => f.quantidade > 0);
  if (funilComDados.length > 0) {
    secoes.push({
      tipo: "barras",
      titulo: "Funil por etapa do Kanban",
      itens: funilComDados.map((f) => ({ label: f.label, valor: f.quantidade, valorLabel: `${f.quantidade}` })),
    });
  }

  if (r.porPortal.length > 0) {
    secoes.push({
      tipo: "barras",
      titulo: "Distribuição por portal",
      itens: r.porPortal.map((p) => ({ label: p.label, valor: p.quantidade, valorLabel: `${p.quantidade} (${formatBRL(p.valor)})` })),
    });
  }

  if (r.porUf.length > 0) {
    secoes.push({
      tipo: "barras",
      titulo: "Distribuição por estado (UF)",
      itens: r.porUf.map((u) => ({ label: u.label, valor: u.quantidade, valorLabel: `${u.quantidade}` })),
    });
  }

  if (r.porTipoObjeto.length > 0) {
    secoes.push({
      tipo: "barras",
      titulo: "Distribuição por tipo de objeto",
      itens: r.porTipoObjeto.map((t) => ({ label: t.label, valor: t.quantidade, valorLabel: `${t.quantidade}` })),
    });
  }

  if (r.porOrgao.length > 0) {
    secoes.push({
      tipo: "barras",
      titulo: "Principais órgãos licitantes",
      itens: r.porOrgao.map((o) => ({ label: o.label, valor: o.quantidade, valorLabel: `${o.quantidade}` })),
    });
  }

  if (r.evolucaoMensal.length > 0) {
    secoes.push({
      tipo: "tabela",
      titulo: "Evolução mensal",
      colunas: [
        { label: "Mês", largura: 90 },
        { label: "Captados", largura: 90 },
        { label: "Ganhos", largura: 90 },
        { label: "Perdidos", largura: 90 },
      ],
      linhas: r.evolucaoMensal.map((p) => [p.label, `${p.captados}`, `${p.ganhos}`, `${p.perdidos}`]),
    });
  }

  const bytes = await gerarPdfRelatorio({
    company: company!,
    titulo: "Dashboard de Resultados",
    subtitulo: `Gerado em ${formatDate(new Date().toISOString())}`,
    secoes,
  });

  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="Dashboard de Resultados - ${company!.razaoSocial.replace(/[^a-zA-Z0-9-_ ]/g, "")}.pdf"`,
    },
  });
}
