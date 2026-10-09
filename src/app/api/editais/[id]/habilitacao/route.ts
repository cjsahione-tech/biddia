import { NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { executarAuditoriaHabilitacao } from "@/lib/agents/auditoria-habilitacao";
import { tokenInternoValido } from "@/lib/agents/auditoria-dispatch";

// Executa a auditoria de habilitação de UM edital. Não tem botão na tela: é chamada pelo
// próprio sistema (depois da captação, ao continuar a leitura de um edital grande e ao
// reconferir quando a documentação da empresa muda), com um token assinado e restrito a este
// edital. O dono da conta também pode chamar (usado para testes e suporte).
export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const token = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? null;
  let autorizado = tokenInternoValido(token, id);
  if (!autorizado) {
    const user = await getCurrentUser();
    if (user) {
      const edital = await prisma.edital.findFirst({ where: { id, company: { userId: user.id } }, select: { id: true } });
      autorizado = !!edital;
    }
  }
  if (!autorizado) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { continuacao?: number; modo?: string };
  const continuacao = Number.isInteger(body.continuacao) ? Math.max(0, Number(body.continuacao)) : 0;
  const modo = body.modo === "reconferir" ? "reconferir" : "completo";
  const origem = new URL(req.url).origin;

  // Primeira execução: não repete se já há uma em andamento (evita gasto duplicado de IA).
  if (continuacao === 0) {
    const aud = await prisma.auditoriaHabilitacao.findUnique({ where: { editalId: id } });
    if (aud?.estado === "RODANDO" && Date.now() - aud.updatedAt.getTime() < 3 * 60_000) {
      return NextResponse.json({ ok: true, ignorada: "já em andamento" }, { status: 202 });
    }
  }

  after(async () => {
    await executarAuditoriaHabilitacao(id, { continuacao, modo, origem });
  });

  return NextResponse.json({ ok: true }, { status: 202 });
}
