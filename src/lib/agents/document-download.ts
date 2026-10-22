import { prisma } from "@/lib/prisma";
import { baixarArquivoPncp } from "@/lib/agents/pncp";
import { baixarArquivoLicitaNet } from "@/lib/agents/licitanet";
import { subirAnexo, apagarAnexo, caminhoDocumentoEdital, isStorageConfigured } from "@/lib/storage";
import { ehErroDeArmazenamentoIndisponivel } from "@/lib/armazenamento-estado";

// Sem Storage configurado, só o que cabe no banco (base64) é guardado; acima disso exige o Storage.
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
 * baixarArquivoPncp/baixarArquivoLicitaNet) e persiste no Document — usado tanto pelo download em lote
 * (baixarDocumentosPendentes) quanto pelo download avulso disparado pelo usuário
 * (GET .../documents/[docId]/download), pra nunca haver dois comportamentos de
 * persistência divergentes. Lança se o download falhar mesmo após as tentativas.
 *
 * Com o Storage configurado, TODO arquivo vai para ele (os PDFs dentro do banco o deixaram com 655 MB);
 * o base64 no banco é só o plano B se o Storage falhar num arquivo pequeno.
 */
export async function baixarEPersistirDocumento(
  doc: DocumentoParaBaixar,
  companyId: string
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const baixar = doc.tipo === "DOCUMENTO_LICITANET" ? baixarArquivoLicitaNet : baixarArquivoPncp;
  const arquivo = await baixar(doc.origemUrl);
  const grande = arquivo.bytes.byteLength > LIMITE_BASE64_INLINE;

  // Só grava se ninguém gravou antes: duas execuções baixando o mesmo documento ao mesmo tempo não deixam
  // arquivo sobrando no Storage nem sobrescrevem uma cópia já salva.
  const semCopia = { id: doc.id, storagePath: null, conteudoBase64: null };

  if (isStorageConfigured() || grande) {
    const path = caminhoDocumentoEdital(companyId, doc.editalId, doc.id, doc.nome);
    try {
      await subirAnexo(path, arquivo.bytes, arquivo.contentType);
      const { count } = await prisma.document.updateMany({ where: semCopia, data: { storagePath: path } });
      if (count === 0) await apagarAnexo(path).catch(() => null);
      return arquivo;
    } catch (err) {
      // Storage bloqueado: NÃO enche o banco com cópias (já deixou 44 MB lá). O arquivo recém-baixado serve para esta
      // leitura; sem cópia salva, na próxima vez ele é baixado de novo da origem.
      if (ehErroDeArmazenamentoIndisponivel(err)) {
        console.warn(`Armazenamento indisponível — documento ${doc.id} usado sem salvar cópia.`);
        return arquivo;
      }
      if (grande) throw err; // arquivo grande não cabe no banco
      console.error(`Storage indisponível para o documento ${doc.id} — guardando no banco:`, err);
    }
  }

  await prisma.document.updateMany({
    where: semCopia,
    data: { conteudoBase64: `data:${arquivo.contentType};base64,${Buffer.from(arquivo.bytes).toString("base64")}` },
  });
  return arquivo;
}
