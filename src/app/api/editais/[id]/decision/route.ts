import { NextResponse, after } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireCompany } from "@/lib/api-utils";
import { executarPipelineCompleto } from "@/lib/agents/pipeline";

const schema = z.object({ decision: z.enum(["APROVADO", "REPROVADO"]) });

// A esteira completa (Analista → Financeiro → Advogado → Secretário → Auditor,
// agora lendo o PDF real) pode passar de 60s. 60 é o teto do plano Hobby da
// Vercel; em um plano pago isso pode ser aumentado.
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
    // Roda a esteira dos agentes 2 a 6 em segundo plano, depois da resposta ser enviada.
    // Usa after() (em vez de uma Promise solta) porque é a forma que o Next.js garante
    // que o trabalho realmente termina — tanto em dev quanto em produção na Vercel.
    after(async () => {
      try {
        await executarPipelineCompleto(id);
      } catch (err) {
        console.error(`Falha no pipeline do edital ${id}:`, err);
      }
    });
  }

  return NextResponse.json({ edital: updated });
}
