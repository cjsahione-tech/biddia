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
