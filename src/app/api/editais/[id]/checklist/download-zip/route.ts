import { NextResponse } from "next/server";
import JSZip from "jszip";
import { prisma } from "@/lib/prisma";
import { requireCompany } from "@/lib/api-utils";
import { nomePastaCategoria } from "@/lib/habilitacao-categorias";
import { baixarAnexo } from "@/lib/storage";

export const maxDuration = 30;

/** Monta um .zip com todos os documentos já anexados ao checklist, organizados em uma
 * pasta por categoria de habilitação (Fiscal, Trabalhista, etc.) — itens sem categoria
 * reconhecida caem numa pasta "Outros" em vez de serem descartados. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { company, error } = await requireCompany();
  if (error) return error;
  const { id } = await params;

  const edital = await prisma.edital.findFirst({ where: { id, companyId: company!.id } });
  if (!edital) return NextResponse.json({ error: "Edital não encontrado" }, { status: 404 });

  const itens = await prisma.checklistItem.findMany({ where: { editalId: id, anexoDocId: { not: null } } });
  if (itens.length === 0) {
    return NextResponse.json({ error: "Nenhum documento anexado ainda neste checklist." }, { status: 404 });
  }

  const docIds = itens.map((i) => i.anexoDocId).filter((d): d is string => !!d);
  const documentos = await prisma.document.findMany({ where: { id: { in: docIds } } });
  const docPorId = new Map(documentos.map((d) => [d.id, d]));

  const zip = new JSZip();
  const usadosPorPasta = new Map<string, Set<string>>();
  let adicionados = 0;

  for (const item of itens) {
    const doc = item.anexoDocId ? docPorId.get(item.anexoDocId) : undefined;
    if (!doc) continue;

    let bytes: Uint8Array | null = null;
    if (doc.storagePath) {
      bytes = await baixarAnexo(doc.storagePath).catch((err) => {
        console.error(`Falha ao baixar anexo do Storage (${doc.storagePath}) para o ZIP:`, err);
        return null;
      });
    } else if (doc.conteudoBase64) {
      const base64 = doc.conteudoBase64.split(",")[1];
      bytes = base64 ? Buffer.from(base64, "base64") : null;
    }
    if (!bytes) continue;

    const pasta = nomePastaCategoria(item.categoria);
    let nomeArquivo = (item.anexoNome || doc.nome || item.documentoNome).replace(/[\\/]/g, "-");

    // Evita colisão de nome dentro da mesma pasta (ex: dois itens com anexo "certidao.pdf").
    const usados = usadosPorPasta.get(pasta) ?? new Set<string>();
    if (usados.has(nomeArquivo)) {
      const ponto = nomeArquivo.lastIndexOf(".");
      const base = ponto > 0 ? nomeArquivo.slice(0, ponto) : nomeArquivo;
      const ext = ponto > 0 ? nomeArquivo.slice(ponto) : "";
      let n = 2;
      while (usados.has(`${base} (${n})${ext}`)) n++;
      nomeArquivo = `${base} (${n})${ext}`;
    }
    usados.add(nomeArquivo);
    usadosPorPasta.set(pasta, usados);

    zip.folder(pasta)!.file(nomeArquivo, bytes);
    adicionados++;
  }

  if (adicionados === 0) {
    return NextResponse.json({ error: "Nenhum documento anexado ainda neste checklist." }, { status: 404 });
  }

  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  const nomeZip = `habilitacao-${edital.titulo.replace(/[^a-zA-Z0-9-_ ]/g, "").trim().slice(0, 60) || "edital"}.zip`;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${nomeZip}"`,
    },
  });
}
