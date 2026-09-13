import { prisma } from "@/lib/prisma";

/** Shape do edital vinculado devolvido junto do estudo — usado por toda rota que
 * retorna um EstudoViabilidade, para o cliente sempre receber o mesmo formato. */
export const estudoInclude = {
  edital: {
    select: {
      id: true,
      titulo: true,
      orgaoNome: true,
      municipio: true,
      uf: true,
      modalidade: true,
      valorGlobal: true,
      orcamentoSigiloso: true,
      dataEncerramentoProposta: true,
      proposal: { select: { itensJson: true, valorGlobalReferencia: true } },
    },
  },
} as const;

export async function carregarEstudoDaEmpresa(id: string, companyId: string) {
  return prisma.estudoViabilidade.findFirst({ where: { id, companyId } });
}

/**
 * Reúne tudo que o relatório final (Etapa 6) precisa — usado tanto pela rota que
 * alimenta a tela quanto pela que gera o PDF, para as duas nunca divergirem.
 */
export async function montarRelatorioEstudo(estudoId: string, companyId: string) {
  const estudo = await prisma.estudoViabilidade.findFirst({
    where: { id: estudoId, companyId },
    include: estudoInclude,
  });
  if (!estudo) return null;

  const custosItens = await prisma.custoItemEstudo.findMany({
    where: { estudoId },
    orderBy: { itemIndex: "asc" },
  });

  return {
    estudo,
    requisitos: estudo.requisitosJson ? JSON.parse(estudo.requisitosJson) : null,
    aliquotas: estudo.aliquotasJson ? JSON.parse(estudo.aliquotasJson) : null,
    itensSnapshot: estudo.itensSnapshotJson
      ? (JSON.parse(estudo.itensSnapshotJson) as { descricao: string; unidade: string; quantidade: number }[])
      : [],
    custosItens: custosItens.map((c) => ({ itemIndex: c.itemIndex, custos: JSON.parse(c.custosJson) })),
    resultadoCalculo: estudo.resultadoCalculoJson ? JSON.parse(estudo.resultadoCalculoJson) : null,
  };
}
