import { NextResponse } from "next/server";
import { requireCompany } from "@/lib/api-utils";
import { montarRelatorioHabilitacao } from "@/lib/habilitacao-relatorio";
import { gerarPdfPendenciasHabilitacao } from "@/lib/habilitacao-pdf";

// PDF do relatório de pendências de habilitação (baixar/imprimir). Só da empresa dona do edital.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { company, error } = await requireCompany();
  if (error) return error;
  const { id } = await params;

  const relatorio = await montarRelatorioHabilitacao(id, company!.id);
  if (!relatorio) return NextResponse.json({ error: "Edital não encontrado" }, { status: 404 });
  if (!relatorio.auditoria || relatorio.auditoria.estado !== "CONCLUIDA") {
    return NextResponse.json({ error: "A auditoria deste edital ainda não terminou — o relatório fica disponível assim que ela concluir." }, { status: 409 });
  }

  const pdf = await gerarPdfPendenciasHabilitacao(company!, relatorio);
  const nomeArquivo = `pendencias-habilitacao-${relatorio.edital.titulo.replace(/[^a-zA-Z0-9]+/g, "-").slice(0, 50)}.pdf`;
  return new NextResponse(Buffer.from(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${nomeArquivo}"` },
  });
}
