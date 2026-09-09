import { prisma } from "@/lib/prisma";
import { askJSON } from "@/lib/anthropic";
import { obterTextoCompletoEdital } from "@/lib/agents/pdf-extract";
import { withAgentRun, logAudit } from "@/lib/agents/run-tracker";

type ItemProposta = {
  descricao: string;
  unidade: string;
  quantidade: number;
  valorUnitario: number;
};

type FinanceiroResult = {
  itensEncontradosNoTexto: boolean;
  itens: ItemProposta[];
  observacoes: string;
};

export async function executarAgente3(editalId: string) {
  return withAgentRun(editalId, "agente3-financeiro", async () => {
    const edital = await prisma.edital.findUniqueOrThrow({ where: { id: editalId } });
    const analysis = await prisma.analysis.findUnique({ where: { editalId } });

    const valorReferencia = edital.valorGlobal;
    if (!valorReferencia) {
      await logAudit(
        editalId,
        "Agente Financeiro",
        "Busca de tabela de referência",
        "ALERTA",
        "O PNCP não publicou valor total estimado para este edital. A proposta foi montada sem uma base de valor de referência confirmada.",
      );
    }

    const { textoEdital, textoTermoReferencia, temTextoCompleto } =
      await obterTextoCompletoEdital(editalId);

    const contexto = `
Objeto: ${edital.titulo}
Descrição: ${edital.descricao}
Resumo do objeto (análise): ${analysis?.resumoObjeto ?? "não disponível"}
Valor global de referência publicado no PNCP: ${valorReferencia ?? "não publicado"}
${textoEdital ? `\n=== TEXTO COMPLETO DO EDITAL ===\n${textoEdital}` : ""}
${textoTermoReferencia ? `\n=== TEXTO COMPLETO DO TERMO DE REFERÊNCIA ===\n${textoTermoReferencia}` : ""}
`.trim();

    const instrucaoFonte = temTextoCompleto
      ? `Você TEM ACESSO ao texto completo do edital e/ou termo de referência acima. Esses documentos costumam
trazer uma planilha ou lista formal de itens (descrição, unidade, quantidade e, às vezes, valor unitário
estimado). PROCURE essa lista real primeiro e transcreva os itens dela — não invente uma composição alternativa
se os itens reais estiverem no texto. Marque "itensEncontradosNoTexto": true nesse caso. Só estime valores de
mercado para o(s) campo(s) que realmente não constarem no texto (ex: quando o edital lista os itens mas não o
valor unitário).`
      : `O texto completo do edital não estava disponível — você não tem como saber a lista real de itens. Monte
uma composição PLAUSÍVEL com base no objeto e no valor de referência (quando houver), e marque
"itensEncontradosNoTexto": false. Deixe claro nas observações que isso é uma estimativa e precisa ser conferida
pelo usuário contra o edital real antes do envio.`;

    const result = await askJSON<FinanceiroResult>(
      `Você é o agente financeiro de uma empresa que está estruturando uma proposta comercial para um edital
público brasileiro. Monte a composição de itens (descrição, unidade, quantidade e valor unitário) da proposta.

${instrucaoFonte}

A soma dos itens deve fechar aproximadamente no valor de referência informado, quando houver.
Responda em JSON:
{
  "itensEncontradosNoTexto": boolean,
  "itens": [{ "descricao": string, "unidade": string, "quantidade": number, "valorUnitario": number }],
  "observacoes": string (explique a origem dos números — transcrito do edital ou estimado — e alerte para revisão antes do envio)
}
Gere entre 2 e 20 itens (tantos quantos o edital realmente listar, se disponível). Use números puros (sem "R$" ou separadores) em quantidade e valorUnitario.`,
      contexto,
      { maxTokens: 6000 }
    );

    const itensComTotal = result.itens.map((item) => ({
      ...item,
      valorTotal: Number((item.quantidade * item.valorUnitario).toFixed(2)),
    }));
    const somaItens = itensComTotal.reduce((acc, i) => acc + i.valorTotal, 0);

    await prisma.proposal.upsert({
      where: { editalId },
      create: {
        editalId,
        valorGlobalReferencia: valorReferencia ?? somaItens,
        itensJson: JSON.stringify(itensComTotal),
        observacoes: result.observacoes,
        baseadoEmTextoCompleto: !!result.itensEncontradosNoTexto,
      },
      update: {
        valorGlobalReferencia: valorReferencia ?? somaItens,
        itensJson: JSON.stringify(itensComTotal),
        observacoes: result.observacoes,
        baseadoEmTextoCompleto: !!result.itensEncontradosNoTexto,
      },
    });

    await logAudit(
      editalId,
      "Agente Financeiro",
      "Montagem da proposta",
      "OK",
      `Proposta montada com ${itensComTotal.length} item(ns) (${result.itensEncontradosNoTexto ? "transcritos do texto do edital" : "estimados, texto do edital indisponível"}), somando R$ ${somaItens.toFixed(2)}.`
    );

    return { itens: itensComTotal, valorGlobalReferencia: valorReferencia ?? somaItens };
  });
}
