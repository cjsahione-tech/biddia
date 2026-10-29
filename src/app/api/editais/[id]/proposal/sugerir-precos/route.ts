import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCompany } from "@/lib/api-utils";
import { parseItens, round2 } from "@/lib/proposal";
import { preencherPrecosFaltantes } from "@/lib/agents/agente3-financeiro";
import { comContextoIA } from "@/lib/ia-contexto";
import { logAudit } from "@/lib/agents/run-tracker";
import { descreverErro } from "@/lib/ia-erros";

export const maxDuration = 60;

/**
 * Sugestão de preço de mercado para os itens que o EDITAL não trouxe com preço — só quando a pessoa clica em "Sugerir
 * preços de mercado". O Agente Financeiro nunca faz isso sozinho: preço que não vem do edital é sempre uma escolha
 * da pessoa. Itens que já têm preço (inclusive os editados à mão) nunca são tocados; os preenchidos ficam marcados como
 * "sugestão" até a pessoa editar o valor.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { company, error } = await requireCompany();
  if (error) return error;
  const { id } = await params;

  const edital = await prisma.edital.findFirst({ where: { id, companyId: company!.id } });
  if (!edital) return NextResponse.json({ error: "Edital não encontrado" }, { status: 404 });

  const proposal = await prisma.proposal.findUnique({ where: { editalId: id } });
  if (!proposal) return NextResponse.json({ error: "Este edital ainda não tem uma proposta financeira" }, { status: 404 });

  const itens = parseItens(proposal.itensJson);
  const semPreco = itens.filter((i) => !i.editadoManualmente && (!i.valorUnitario || i.valorUnitario === 0));
  if (semPreco.length === 0) {
    return NextResponse.json({ error: "Todos os itens já têm preço." }, { status: 400 });
  }

  try {
    const { itens: preenchidos, qtdEstimados } = await comContextoIA({ agente: "agente3-financeiro", editalId: id }, () =>
      // Só os itens sem preço e não editados vão para a IA (índices preservados no retorno).
      preencherPrecosFaltantes(
        { titulo: edital.titulo, descricao: edital.descricao },
        itens.map((it) =>
          it.editadoManualmente ? { ...it, valorUnitario: it.valorUnitario || 1 } : it
        )
      )
    );

    // Itens editados à mão ficam exatamente como estavam (o truque acima só os tirou da fila da IA).
    const finais = itens.map((original, i) => {
      if (original.editadoManualmente) return original;
      const novo = preenchidos[i];
      if (!novo || novo.precoSugerido !== true) return original;
      return {
        ...original,
        valorUnitario: novo.valorUnitario,
        valorTotal: round2(original.quantidade * novo.valorUnitario),
        precoSugerido: true,
      };
    });

    if (qtdEstimados === 0) {
      return NextResponse.json({ error: "Não consegui sugerir preços agora. Tente de novo em instantes." }, { status: 502 });
    }

    const updated = await prisma.proposal.update({ where: { editalId: id }, data: { itensJson: JSON.stringify(finais) } });
    await logAudit(
      id,
      "Agente Financeiro",
      "Sugestão de preços",
      "OK",
      `A pedido do usuário, ${qtdEstimados} item(ns) sem preço no edital receberam uma sugestão de preço de mercado. É só uma sugestão: não vem do edital.`
    ).catch(() => {});
    return NextResponse.json({ proposal: updated, sugeridos: qtdEstimados });
  } catch (err) {
    console.error(`Falha ao sugerir preços do edital ${id}:`, err);
    return NextResponse.json({ error: `Não foi possível sugerir os preços agora: ${descreverErro(err)}` }, { status: 502 });
  }
}
