import { NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCompany } from "@/lib/api-utils";
import { executarAnaliseIA } from "@/lib/agents/pipeline";

// Segunda invocação da esteira: roda Analista/Financeiro/Advogado com orçamento de
// tempo próprio — o download e a extração do texto já aconteceram na chamada anterior
// (ver dispararPipeline em pipeline.ts), sem disputar tempo com eles. Ao final, aciona
// a terceira invocação (Secretário → Auditor, /continuar-pipeline), inalterada.
export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { company, error } = await requireCompany();
  if (error) return error;
  const { id } = await params;

  const edital = await prisma.edital.findFirst({ where: { id, companyId: company!.id } });
  if (!edital) return NextResponse.json({ error: "Edital não encontrado" }, { status: 404 });

  const cookie = req.headers.get("cookie") ?? "";
  const origin = new URL(req.url).origin;

  after(async () => {
    // Espera o lote paralelo até 52s: se algum agente estiver demorando muito (edital
    // grande), ainda assim dispara a continuação dentro do teto de 60s da Vercel — o
    // Auditor, na próxima chamada, aguarda um agente ainda em execução antes de decidir
    // reexecutá-lo.
    const timeout = new Promise((resolve) => setTimeout(resolve, 52_000));
    try {
      await Promise.race([executarAnaliseIA(id), timeout]);
    } catch (err) {
      console.error(`Falha na etapa de análise do pipeline do edital ${id}:`, err);
    }

    try {
      await fetch(`${origin}/api/editais/${id}/continuar-pipeline`, {
        method: "POST",
        headers: { cookie },
      });
    } catch (err) {
      console.error(`Falha ao disparar a continuação do pipeline do edital ${id}:`, err);
    }
  });

  return NextResponse.json({ ok: true });
}
