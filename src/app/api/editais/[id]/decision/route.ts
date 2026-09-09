import { NextResponse, after } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireCompany } from "@/lib/api-utils";
import { executarPipelineCompleto } from "@/lib/agents/pipeline";

const schema = z.object({ decision: z.enum(["APROVADO", "REPROVADO"]) });

// Analista, Financeiro e Advogado rodam em paralelo aqui, lendo o PDF real do edital —
// isso ainda pode chegar perto de 60s (teto do plano Hobby da Vercel). O Secretário e o
// Auditor rodam numa segunda chamada (continuar-pipeline), com orçamento próprio.
export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { company, error } = await requireCompany();
  if (error) return error;
  const { id } = await params;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Decisão inválida" }, { status: 400 });

  const edital = await prisma.edital.findFirst({ where: { id, companyId: company!.id } });
  if (!edital) return NextResponse.json({ error: "Edital não encontrado" }, { status: 404 });

  const updated = await prisma.edital.update({
    where: { id },
    data: { status: parsed.data.decision, decidedAt: new Date() },
  });

  if (parsed.data.decision === "APROVADO") {
    const cookie = req.headers.get("cookie") ?? "";
    const origin = new URL(req.url).origin;

    // Usa after() (em vez de uma Promise solta) porque é a forma que o Next.js garante
    // que o trabalho realmente termina — tanto em dev quanto em produção na Vercel.
    after(async () => {
      try {
        await executarPipelineCompleto(id);
      } catch (err) {
        console.error(`Falha no pipeline do edital ${id}:`, err);
      }

      // Dispara a continuação (Secretário → Auditor) como uma nova chamada HTTP, para
      // que ela ganhe seu próprio orçamento de execução em vez de disputar o que sobrou
      // desta.
      try {
        await fetch(`${origin}/api/editais/${id}/continuar-pipeline`, {
          method: "POST",
          headers: { cookie },
        });
      } catch (err) {
        console.error(`Falha ao disparar a continuação do pipeline do edital ${id}:`, err);
      }
    });
  }

  return NextResponse.json({ edital: updated });
}
