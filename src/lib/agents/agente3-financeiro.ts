import { prisma } from "@/lib/prisma";
import { askJSON } from "@/lib/anthropic";
import { withAgentRun, logAudit } from "@/lib/agents/run-tracker";

type ItemProposta = {
  descricao: string;
  unidade: string;
  quantidade: number;
  valorUnitario: number;
};

type FinanceiroResult = {
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

    const contexto = `
Objeto: ${edital.titulo}
Descrição: ${edital.descricao}
Resumo do objeto (análise): ${analysis?.resumoObjeto ?? "não disponível"}
Valor global de referência publicado no PNCP: ${valorReferencia ?? "não publicado"}
`.trim();

    const result = await askJSON<FinanceiroResult>(
      `Você é o agente financeiro de uma empresa que está estruturando uma proposta comercial para um edital
público brasileiro. Com base no objeto do edital e no valor de referência informado (quando existir), monte uma
composição de itens plausível (descrição, unidade, quantidade e valor unitário) cuja soma feche aproximadamente
no valor de referência informado. Se não houver valor de referência, estime um valor de mercado razoável e deixe
isso explícito nas observações.
Responda em JSON:
{
  "itens": [{ "descricao": string, "unidade": string, "quantidade": number, "valorUnitario": number }],
  "observacoes": string (explique a lógica da composição e alerte que os valores devem ser revisados pelo usuário antes do envio)
}
Gere entre 2 e 8 itens. Use números puros (sem "R$" ou separadores) em quantidade e valorUnitario.`,
      contexto
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
      },
      update: {
        valorGlobalReferencia: valorReferencia ?? somaItens,
        itensJson: JSON.stringify(itensComTotal),
        observacoes: result.observacoes,
      },
    });

    await logAudit(
      editalId,
      "Agente Financeiro",
      "Montagem da proposta",
      "OK",
      `Proposta montada com ${itensComTotal.length} item(ns), somando R$ ${somaItens.toFixed(2)}.`
    );

    return { itens: itensComTotal, valorGlobalReferencia: valorReferencia ?? somaItens };
  });
}
