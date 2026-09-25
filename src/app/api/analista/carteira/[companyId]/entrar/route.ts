import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api-utils";
import { signSession, setSessionCookie, setAnalistaOrigemCookie, COOKIE_NAME } from "@/lib/auth";
import { cookies } from "next/headers";

// Troca a sessão atual (Analista) pela sessão do User dono da empresa-cliente — só
// permitido se a empresa realmente pertence à carteira deste Analista (checagem de
// autorização crítica, não só de autenticação). A sessão do Analista fica guardada no
// cookie de origem, pra "voltar" sem logar de novo (ver POST /api/analista/voltar).
export async function POST(_req: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const { user, error } = await requireUser();
  if (error) return error;
  if (user!.tipoConta !== "ANALISTA") {
    return NextResponse.json({ error: "Só contas de Analista podem entrar em um cliente" }, { status: 403 });
  }

  const { companyId } = await params;
  const vinculo = await prisma.analistaCliente.findUnique({
    where: { companyId },
    include: { company: { select: { userId: true } } },
  });
  if (!vinculo || vinculo.analistaId !== user!.id) {
    return NextResponse.json({ error: "Esta empresa não está na sua carteira" }, { status: 403 });
  }

  const store = await cookies();
  const sessaoAtual = store.get(COOKIE_NAME)?.value;
  if (sessaoAtual) await setAnalistaOrigemCookie(sessaoAtual);

  const novoToken = signSession({ userId: vinculo.company.userId });
  await setSessionCookie(novoToken);

  return NextResponse.json({ ok: true });
}
