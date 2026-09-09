import { NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCompany } from "@/lib/api-utils";
import { executarAgente5 } from "@/lib/agents/agente5-secretario";
import { executarAgente6 } from "@/lib/agents/agente6-auditor";
import { logAudit } from "@/lib/agents/run-tracker";

// Continuação da esteira (Secretário → Auditor), disparada pela própria rota de decisão
// como uma segunda invocação — assim ela ganha seu próprio orçamento de execução na
// Vercel, em vez de disputar o que sobrou dos 60s da primeira chamada (Analista,
// Financeiro e Advogado já rodaram e podem chegar perto do limite sozinhos).
export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { company, error } = await requireCompany();
  if (error) return error;
  const { id } = await params;

  const edital = await prisma.edital.findFirst({ where: { id, companyId: company!.id } });
  if (!edital) return NextResponse.json({ error: "Edital não encontrado" }, { status: 404 });

  after(async () => {
    try {
      await executarAgente5(id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "erro desconhecido";
      await logAudit(id, "Agente Secretário", "Execução", "ERRO", `Falha na execução: ${msg}`);
    }
    try {
      await executarAgente6(id);
    } catch (err) {
      console.error(`Falha no Agente Auditor do edital ${id}:`, err);
    }
  });

  return NextResponse.json({ ok: true });
}
