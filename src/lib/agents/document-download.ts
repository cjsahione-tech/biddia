import { prisma } from "@/lib/prisma";
import { baixarArquivoPncp } from "@/lib/agents/pncp";
import { baixarArquivoLicitaNet } from "@/lib/agents/licitanet";
import { subirAnexo, caminhoDocumentoEdital } from "@/lib/storage";

// Acima disso, um documento baixado do PNCP/LicitaNet vai pro Storage em vez de base64
// inline no Postgres — mesmo teto usado em baixarDocumentosPendentes.
const LIMITE_BASE64_INLINE = 4 * 1024 * 1024;

export type DocumentoParaBaixar = {
  id: string;
  editalId: string;
  nome: string;
  tipo: string; // "DOCUMENTO_PNCP" | "DOCUMENTO_LICITANET"
  origemUrl: string;
};

/**
 * Baixa o arquivo de origem de UM documento (PNCP ou LicitaNet, já com retry — ver
 * baixarArquivoPncp/baixarArquivoLicitaNet) e persiste no Document (Storage pra arquivo
 * grande, base64 inline pro resto) — usado tanto pelo download em lote
 * (baixarDocumentosPendentes) quanto pelo download avulso disparado pelo usuário
 * (GET .../documents/[docId]/download), pra nunca haver dois comportamentos de
 * persistência divergentes. Lança se o download falhar mesmo após as tentativas.
 */
export async function baixarEPersistirDocumento(
  doc: DocumentoParaBaixar,
  companyId: string
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const baixar = doc.tipo === "DOCUMENTO_LICITANET" ? baixarArquivoLicitaNet : baixarArquivoPncp;
  const arquivo = await baixar(doc.origemUrl);

  if (arquivo.bytes.byteLength > LIMITE_BASE64_INLINE) {
    const path = caminhoDocumentoEdital(companyId, doc.editalId, doc.id, doc.nome);
    await subirAnexo(path, arquivo.bytes, arquivo.contentType);
    await prisma.document.update({ where: { id: doc.id }, data: { storagePath: path } });
  } else {
    await prisma.document.update({
      where: { id: doc.id },
      data: { conteudoBase64: `data:${arquivo.contentType};base64,${Buffer.from(arquivo.bytes).toString("base64")}` },
    });
  }

  return arquivo;
}
