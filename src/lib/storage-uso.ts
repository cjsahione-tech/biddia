import { prisma } from "@/lib/prisma";
import { apagarAnexo } from "@/lib/storage";

/**
 * Apaga um arquivo do Storage só se NENHUM registro (documento de edital ou da base da empresa) ainda aponta
 * para ele. O Secretário copia para o checklist do edital o mesmo arquivo da base de documentos da empresa;
 * apagar o arquivo ao remover um dos lados deixava o outro apontando para o nada. Chamar DEPOIS de remover o
 * registro que usava o caminho.
 */
export async function apagarAnexoSeLivre(caminho: string): Promise<boolean> {
  const [documentos, daEmpresa] = await Promise.all([
    prisma.document.count({ where: { storagePath: caminho } }),
    prisma.companyDocument.count({ where: { storagePath: caminho } }),
  ]);
  if (documentos + daEmpresa > 0) return false;
  await apagarAnexo(caminho).catch(() => null);
  return true;
}
