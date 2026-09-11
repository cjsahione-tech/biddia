import { prisma } from "@/lib/prisma";

/**
 * Registra a chave PNCP de editais excluídos pelo usuário para o Agente Comercial nunca
 * mais recapturá-los numa busca futura. A exclusão normal do Edital (cascata no schema)
 * não deixa rastro dessa chave — sem este registro à parte, a checagem de duplicidade da
 * busca (que só olha os editais que ainda existem) não veria o edital excluído e o
 * traria de volta como "novo".
 */
export async function registrarExclusaoPermanente(
  editais: { companyId: string; numeroControlePNCP: string; fonte: string }[]
) {
  const relevantes = editais.filter((e) => e.fonte !== "MANUAL");
  if (relevantes.length === 0) return;
  await prisma.editalExcluido.createMany({
    data: relevantes.map((e) => ({ companyId: e.companyId, numeroControlePNCP: e.numeroControlePNCP })),
    skipDuplicates: true,
  });
}
