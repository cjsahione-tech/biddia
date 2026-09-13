import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCompany } from "@/lib/api-utils";
import { baixarArquivoPncp } from "@/lib/agents/pncp";
import { baixarArquivoLicitaNet } from "@/lib/agents/licitanet";

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
  const oficial = doc.tipo === "DOCUMENTO_PNCP" || doc.tipo === "DOCUMENTO_LICITANET";
  if (doc.conteudoBase64) {
    return respondFromDataUrl(doc.conteudoBase64, oficial ? nomeArquivo : `${nomeArquivo}.pdf`);
  }

  // Sem cópia local (download imediato falhou na captura, ou é um registro antigo):
  // tenta buscar direto na fonte oficial como último recurso.
  if (oficial && doc.origemUrl) {
    const baixar = doc.tipo === "DOCUMENTO_LICITANET" ? baixarArquivoLicitaNet : baixarArquivoPncp;
    const fonte = doc.tipo === "DOCUMENTO_LICITANET" ? "LicitaNet" : "PNCP";
    const arquivo = await baixar(doc.origemUrl);
    if (!arquivo) {
      return NextResponse.json(
        { error: `Não foi possível obter o arquivo no ${fonte} no momento. Tente novamente em instantes.` },
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
