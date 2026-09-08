import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCompany } from "@/lib/api-utils";
import { baixarArquivoPncp } from "@/lib/agents/pncp";

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

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; docId: string }> }
) {
  const { company, error } = await requireCompany();
  if (error) return error;
  const { id, docId } = await params;

  const edital = await prisma.edital.findFirst({ where: { id, companyId: company!.id } });
  if (!edital) return NextResponse.json({ error: "Edital não encontrado" }, { status: 404 });

  const doc = await prisma.document.findFirst({ where: { id: docId, editalId: id } });
  if (!doc) return NextResponse.json({ error: "Documento não encontrado" }, { status: 404 });

  const nomeArquivo = doc.nome.replace(/[^a-zA-Z0-9-_. ]/g, "");

  // Caminho rápido: o Agente Comercial já baixou este arquivo (edital/TR do PNCP, ou
  // anexo gerado) no momento da captura. Serve direto do banco, sem depender do PNCP
  // estar no ar agora.
  if (doc.conteudoBase64) {
    return respondFromDataUrl(doc.conteudoBase64, doc.tipo === "DOCUMENTO_PNCP" ? nomeArquivo : `${nomeArquivo}.pdf`);
  }

  // Sem cópia local (download imediato falhou na captura, ou é um registro antigo):
  // tenta buscar direto na fonte oficial como último recurso.
  if (doc.tipo === "DOCUMENTO_PNCP" && doc.origemUrl) {
    const arquivo = await baixarArquivoPncp(doc.origemUrl);
    if (!arquivo) {
      return NextResponse.json(
        { error: "Não foi possível obter o arquivo no PNCP no momento. Tente novamente em instantes." },
        { status: 502 }
      );
    }
    return new NextResponse(Buffer.from(arquivo.bytes), {
      headers: {
        "Content-Type": arquivo.contentType,
        "Content-Disposition": `inline; filename="${nomeArquivo}"`,
      },
    });
  }

  return NextResponse.json({ error: "Documento não encontrado" }, { status: 404 });
}
