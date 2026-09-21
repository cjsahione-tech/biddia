import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCompany } from "@/lib/api-utils";
import { criarUrlDownload } from "@/lib/storage";

function respondFromDataUrl(dataUrl: string, filename: string) {
  const [meta, base64] = dataUrl.split(",");
  const contentType = meta.match(/^data:(.*);base64$/)?.[1] ?? "application/pdf";
  return new NextResponse(Buffer.from(base64, "base64"), {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `inline; filename="${filename}"`,
    },
  });
}

export async function GET(_req: Request, { params }: { params: Promise<{ docId: string }> }) {
  const { company, error } = await requireCompany();
  if (error) return error;
  const { docId } = await params;

  const documento = await prisma.companyDocument.findFirst({ where: { id: docId, companyId: company!.id } });
  if (!documento) return NextResponse.json({ error: "Documento não encontrado" }, { status: 404 });

  const nomeArquivo = documento.nome.replace(/[^a-zA-Z0-9-_. ]/g, "");

  if (documento.storagePath) {
    try {
      const url = await criarUrlDownload(documento.storagePath);
      return NextResponse.redirect(url);
    } catch (err) {
      console.error("Falha ao gerar URL de download do Storage:", err);
      return NextResponse.json({ error: "Não foi possível obter o arquivo agora. Tente novamente." }, { status: 502 });
    }
  }

  if (documento.conteudoBase64) {
    return respondFromDataUrl(documento.conteudoBase64, nomeArquivo);
  }

  return NextResponse.json({ error: "Documento não encontrado" }, { status: 404 });
}
