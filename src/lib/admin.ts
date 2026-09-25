import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

// Controle de acesso ao painel /admin: só a env var ADMIN_EMAILS (e-mails separados por
// vírgula) decide quem é admin — sem role editável pela interface nem fluxo de
// auto-promoção. Pra adicionar um admin novo, edite ADMIN_EMAILS nas configurações do
// projeto na Vercel (Settings → Environment Variables) e faça um redeploy.
function emailsAdmin(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: string): boolean {
  return emailsAdmin().includes(email.trim().toLowerCase());
}

export async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user) {
    return { user: null, error: NextResponse.json({ error: "Não autenticado" }, { status: 401 }) };
  }
  if (!isAdminEmail(user.email)) {
    return { user: null, error: NextResponse.json({ error: "Acesso restrito" }, { status: 403 }) };
  }
  return { user, error: null };
}
