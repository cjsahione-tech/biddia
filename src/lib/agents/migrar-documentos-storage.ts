import { prisma } from "@/lib/prisma";
import { baixarAnexo, caminhoDocumentoEdital, subirAnexo, apagarAnexo } from "@/lib/storage";
import { base64ParaBytes } from "@/lib/agents/pdf-extract";

// Move os arquivos oficiais dos editais (PNCP/LicitaNet) que estão como base64 DENTRO do banco para o Storage —
// eram ~600 MB dos 655 MB do banco. Segurança: só tira o arquivo do banco depois de conferir, no Storage, que
// o conteúdo gravado tem exatamente o mesmo tamanho; qualquer falha deixa o documento como estava.

export type ResultadoMigracao = { migrados: number; falhas: { documento: string; motivo: string }[]; restantes: number; bytesMovidos: number };

const OFICIAIS = ["DOCUMENTO_PNCP", "DOCUMENTO_LICITANET"] as const;

export async function migrarDocumentosParaStorage(opts: { limite?: number; ateMs?: number; companyId?: string } = {}): Promise<ResultadoMigracao> {
  const fim = Date.now() + (opts.ateMs ?? 40_000);
  const limite = opts.limite ?? 1000;
  const resultado: ResultadoMigracao = { migrados: 0, falhas: [], restantes: 0, bytesMovidos: 0 };
  const jaFalharam = new Set<string>();

  const filtro = {
    tipo: { in: [...OFICIAIS] },
    conteudoBase64: { not: null },
    storagePath: null,
    ...(opts.companyId ? { edital: { companyId: opts.companyId } } : {}),
  };

  while (Date.now() < fim && resultado.migrados + jaFalharam.size < limite) {
    // Um por vez: o conteúdo de um documento pode ter dezenas de MB em memória.
    const doc = await prisma.document.findFirst({
      where: { ...filtro, id: { notIn: [...jaFalharam] } },
      select: { id: true, editalId: true, nome: true, conteudoBase64: true, edital: { select: { companyId: true } } },
      orderBy: { createdAt: "asc" },
    });
    if (!doc || !doc.conteudoBase64) break;

    const contentType = doc.conteudoBase64.match(/^data:([^;]+);base64,/)?.[1] ?? "application/pdf";
    const caminho = caminhoDocumentoEdital(doc.edital.companyId, doc.editalId, doc.id, doc.nome);
    try {
      const bytes = base64ParaBytes(doc.conteudoBase64);
      if (bytes.byteLength === 0) throw new Error("conteúdo vazio no banco");
      await subirAnexo(caminho, bytes, contentType);
      const conferido = await baixarAnexo(caminho);
      if (conferido.byteLength !== bytes.byteLength) throw new Error(`tamanho no Storage (${conferido.byteLength}) difere do original (${bytes.byteLength})`);
      const { count } = await prisma.document.updateMany({
        where: { id: doc.id, storagePath: null, conteudoBase64: { not: null } },
        data: { storagePath: caminho, conteudoBase64: null },
      });
      if (count === 0) await apagarAnexo(caminho).catch(() => null); // alguém já moveu/alterou: não deixa arquivo sobrando
      resultado.migrados++;
      resultado.bytesMovidos += bytes.byteLength;
    } catch (err) {
      await apagarAnexo(caminho).catch(() => null);
      jaFalharam.add(doc.id);
      resultado.falhas.push({ documento: doc.id, motivo: err instanceof Error ? err.message : String(err) });
    }
  }

  resultado.restantes = await prisma.document.count({ where: filtro });
  return resultado;
}
