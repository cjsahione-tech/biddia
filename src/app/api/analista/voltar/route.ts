import { NextResponse } from "next/server";
import { getAnalistaOrigemToken, setSessionCookie, clearAnalistaOrigemCookie, verifySession } from "@/lib/auth";

// Restaura a sessão do Analista guardada no cookie de origem (ver
// POST /api/analista/carteira/[companyId]/entrar) — não exige estar autenticado como o
// cliente no momento (a sessão principal pode já ter expirado), só que o cookie de origem
// exista e seja um token válido.
export async function POST() {
  const token = await getAnalistaOrigemToken();
  if (!token || !verifySession(token)) {
    return NextResponse.json({ error: "Nenhuma sessão de Analista pra restaurar" }, { status: 400 });
  }

  await setSessionCookie(token);
  await clearAnalistaOrigemCookie();
  return NextResponse.json({ ok: true });
}
