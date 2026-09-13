import { NextResponse } from "next/server";
import { requireCompany } from "@/lib/api-utils";
import { montarRelatorioEstudo } from "@/lib/estudo-server";
import { gerarPdfRelatorio, type SecaoRelatorio } from "@/lib/agents/pdf";
import { formatBRL, formatDate } from "@/lib/format";
import { RAMO_LABEL } from "@/lib/estudo-viabilidade";
import { REGIME_LABEL, ANEXO_LABEL } from "@/lib/tributos";
import type { RequisitosEstudo } from "@/lib/types";
import type { AliquotasResolvidas } from "@/lib/tributos";
import type { ResultadoCalculoViabilidade } from "@/lib/calculo-viabilidade";
import type { ResultadoDreServico } from "@/lib/calculo-dre-servico";

const INDICADOR_LABEL: Record<string, string> = { VIAVEL: "Viável", MARGINAL: "Marginal", INVIAVEL: "Inviável" };
const DECISAO_LABEL: Record<string, string> = {
  PARTICIPAR: "Participar",
  PARTICIPAR_COM_RESSALVAS: "Participar com ressalvas",
  NAO_PARTICIPAR: "Não participar",
};

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { company, error } = await requireCompany();
  if (error) return error;
  const { id } = await params;

  const relatorio = await montarRelatorioEstudo(id, company!.id);
  if (!relatorio) return NextResponse.json({ error: "Estudo não encontrado" }, { status: 404 });

  const { estudo, requisitos, aliquotas, resultadoCalculo } = relatorio as {
    estudo: typeof relatorio.estudo;
    requisitos: RequisitosEstudo | null;
    aliquotas: AliquotasResolvidas | null;
    resultadoCalculo: ResultadoCalculoViabilidade | ResultadoDreServico | null;
  };

  const secoes: SecaoRelatorio[] = [];

  if (estudo.edital) {
    secoes.push({
      tipo: "campos",
      titulo: "Edital de referência",
      campos: [
        { label: "Título", valor: estudo.edital.titulo },
        { label: "Órgão", valor: `${estudo.edital.orgaoNome} — ${estudo.edital.municipio ?? "?"}/${estudo.edital.uf ?? "?"}` },
        { label: "Modalidade", valor: estudo.edital.modalidade ?? "Não informada" },
        { label: "Valor estimado (teto)", valor: formatBRL(estudo.edital.valorGlobal) },
        { label: "Encerramento", valor: formatDate(estudo.edital.dataEncerramentoProposta?.toISOString() ?? null) },
      ],
    });
  }

  if (requisitos) {
    const camposRequisitos = [
      { label: "Objeto", valor: requisitos.objeto },
      { label: "Critério de julgamento", valor: requisitos.criterioJulgamento },
      { label: "Prazo de execução", valor: requisitos.prazoExecucao },
      { label: "Local de entrega", valor: requisitos.localEntrega },
      { label: "Forma de pagamento", valor: requisitos.formaPagamento },
      { label: "Garantias exigidas", valor: requisitos.garantiasExigidas },
    ];
    if (estudo.ramo === "SERVICO") {
      camposRequisitos.push(
        { label: "Equipe mínima", valor: requisitos.equipeMinima.join("; ") || "—" },
        { label: "Certificações exigidas", valor: requisitos.certificacoesExigidas.join("; ") || "—" }
      );
    } else {
      camposRequisitos.push(
        { label: "Especificação técnica", valor: requisitos.especificacaoTecnica },
        { label: "Prazo de entrega", valor: requisitos.prazoEntrega }
      );
    }
    secoes.push({ tipo: "campos", titulo: "Requisitos do edital", campos: camposRequisitos });
  }

  if (aliquotas) {
    const camposTributos = [{ label: "Regime tributário", valor: REGIME_LABEL[aliquotas.regime] }];
    if (aliquotas.regime === "SIMPLES_NACIONAL" && aliquotas.anexoSimples) {
      camposTributos.push(
        { label: "Anexo", valor: ANEXO_LABEL[aliquotas.anexoSimples] },
        { label: "RBT12", valor: formatBRL(aliquotas.rbt12 ?? 0) }
      );
    }
    camposTributos.push({ label: "Alíquota total efetiva sobre a receita", valor: `${aliquotas.aliquotaTotalEfetiva.toFixed(2)}%` });
    secoes.push({ tipo: "campos", titulo: "Regime tributário", campos: camposTributos });
  }

  if (resultadoCalculo && estudo.ramo === "SERVICO") {
    const dre = resultadoCalculo as unknown as ResultadoDreServico;
    secoes.push({
      tipo: "campos",
      titulo: "Resumo do resultado mensal",
      campos: [
        { label: "Indicador", valor: INDICADOR_LABEL[dre.indicador] ?? dre.indicador },
        { label: "Receita bruta mensal", valor: formatBRL(dre.receitaBrutaMensal) },
        { label: "Custo total mensal", valor: formatBRL(dre.custoTotalMensal) },
        { label: "Lucro líquido mensal", valor: formatBRL(dre.lucroLiquidoMensal) },
        { label: "Margem líquida", valor: `${dre.margemLiquidaPercentual.toFixed(2)}%` },
        { label: "Margem mínima aceitável definida", valor: `${dre.margemMinimaAceitavel.toFixed(2)}%` },
        { label: "Valor global do contrato", valor: `${formatBRL(dre.valorGlobalContrato)} (${dre.duracaoContratoMeses} meses)` },
        { label: "Lucro líquido acumulado no contrato", valor: formatBRL(dre.lucroLiquidoAcumulado) },
      ],
    });

    secoes.push({
      tipo: "texto",
      titulo: `Recomendação: ${DECISAO_LABEL[dre.recomendacao.decisao] ?? dre.recomendacao.decisao}`,
      texto: dre.recomendacao.motivo,
    });

    const colunasDre = [
      { label: "Item", largura: 260 },
      { label: "Valor mensal", largura: 90 },
      { label: "% receita", largura: 70 },
    ];

    secoes.push({
      tipo: "tabela",
      titulo: `DRE detalhada — receita bruta mensal (desconto de ${dre.descontoPercentual}% sobre o teto de ${formatBRL(dre.valorTetoLote)})`,
      colunas: colunasDre,
      linhas: [
        ["(=) RECEITA BRUTA MENSAL", formatBRL(dre.receitaBrutaMensal), "100,00%"],
        ...dre.custosOperacionais.map((l) => [l.nome, formatBRL(l.valorMensal), `${l.percentualDaReceita.toFixed(2)}%`]),
        ["SUBTOTAL — Custos Operacionais Diretos", formatBRL(dre.custosOperacionaisTotal), ""],
        ...dre.folhaPagamento.map((l) => [
          `${l.nome} (${l.quantidade}× ${formatBRL(l.valorUnitarioMensal)})`,
          formatBRL(l.valorMensal),
          `${l.percentualDaReceita.toFixed(2)}%`,
        ]),
        ["SUBTOTAL — Folha de Pagamento (CLT)", formatBRL(dre.folhaPagamentoTotal), ""],
        ...dre.impostos.map((l) => [l.nome, formatBRL(l.valorMensal), `${l.percentualDaReceita.toFixed(2)}%`]),
        ["SUBTOTAL — Impostos", formatBRL(dre.impostosTotal), ""],
        ["(=) CUSTO TOTAL (Operacional + Folha + Impostos)", formatBRL(dre.custoTotalMensal), ""],
        ["(=) LUCRO LÍQUIDO MENSAL", formatBRL(dre.lucroLiquidoMensal), `${dre.margemLiquidaPercentual.toFixed(2)}%`],
      ],
    });

    secoes.push({
      tipo: "tabela",
      titulo: "Composição do custo total por categoria",
      colunas: [
        { label: "Categoria", largura: 260 },
        { label: "Valor mensal", largura: 90 },
        { label: "%", largura: 70 },
      ],
      linhas: dre.composicaoCustoTotal.map((c) => [c.categoria, formatBRL(c.valorMensal), `${c.percentualDoCustoTotal.toFixed(2)}%`]),
    });
  } else if (resultadoCalculo) {
    const dre = resultadoCalculo as unknown as ResultadoCalculoViabilidade;
    const { consolidado, recomendacao } = dre;
    secoes.push({
      tipo: "campos",
      titulo: "Resultado do cálculo de viabilidade",
      campos: [
        { label: "Indicador consolidado", valor: INDICADOR_LABEL[consolidado.indicador] ?? consolidado.indicador },
        { label: "Custo total (direto + indireto)", valor: formatBRL(consolidado.custoDiretoTotal + consolidado.despesasIndiretasTotal) },
        { label: "Preço mínimo viável", valor: formatBRL(consolidado.precoMinimoTotal) },
        { label: "Valor estimado do edital (teto)", valor: formatBRL(consolidado.valorTetoTotal) },
        { label: "Margem líquida no teto", valor: `${consolidado.margemLiquidaConsolidada.toFixed(2)}%` },
        { label: "Margem mínima aceitável definida", valor: `${dre.margemMinimaAceitavel.toFixed(2)}%` },
        {
          label: "Itens",
          valor: `${consolidado.qtdItensViaveis} viável(is), ${consolidado.qtdItensMarginais} marginal(is), ${consolidado.qtdItensInviaveis} inviável(is)`,
        },
      ],
    });

    secoes.push({
      tipo: "texto",
      titulo: `Recomendação: ${DECISAO_LABEL[recomendacao.decisao] ?? recomendacao.decisao}`,
      texto: recomendacao.motivo,
    });

    secoes.push({
      tipo: "tabela",
      titulo: "Detalhamento por item/lote",
      colunas: [
        { label: "Item", largura: 190 },
        { label: "Custo total", largura: 70 },
        { label: "Preço mínimo", largura: 70 },
        { label: "Teto edital", largura: 70 },
        { label: "Margem", largura: 50 },
        { label: "Situação", largura: 63 },
      ],
      linhas: dre.itens.map((item) => [
        item.descricao,
        formatBRL(item.custoDireto + item.despesasIndiretas),
        item.precoMinimoViavel != null ? formatBRL(item.precoMinimoViavel) : "—",
        formatBRL(item.valorTetoEdital),
        `${item.margemLiquidaNoTeto.toFixed(1)}%`,
        INDICADOR_LABEL[item.indicador] ?? item.indicador,
      ]),
    });
  }

  const bytes = await gerarPdfRelatorio({
    company: company!,
    titulo: `Estudo de Viabilidade — ${RAMO_LABEL[estudo.ramo]}`,
    subtitulo: estudo.edital?.titulo,
    secoes,
  });

  const nomeArquivo = `Estudo de Viabilidade - ${estudo.edital?.titulo ?? estudo.id}`.replace(/[^a-zA-Z0-9-_ ]/g, "");

  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${nomeArquivo}.pdf"`,
    },
  });
}
