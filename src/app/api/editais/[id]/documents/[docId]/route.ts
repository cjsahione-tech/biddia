import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCompany } from "@/lib/api-utils";

/** Remove um anexo enviado pelo usuário. Só apaga DOCUMENTO_USUARIO — os documentos
 * oficiais do PNCP e os anexos gerados pelos agentes ficam protegidos daqui. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; docId: string }> }) {
  const { company, error } = await requireCompany();
  if (error) return error;
  const { id, docId } = await params;

  const edital = await prisma.edital.findFirst({ where: { id, companyId: company!.id } });
  if (!edital) return NextResponse.json({ error: "Edital não encontrado" }, { status: 404 });

  const doc = await prisma.document.findFirst({ where: { id: docId, editalId: id } });
  if (!doc) return NextResponse.json({ error: "Documento não encontrado" }, { status: 404 });
  if (doc.tipo !== "DOCUMENTO_USUARIO") {
    return NextResponse.json({ error: "Só é possível excluir anexos enviados por você." }, { status: 403 });
  }

  await prisma.document.delete({ where: { id: docId } });
  return NextResponse.json({ ok: true });
}
