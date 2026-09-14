import { NextResponse } from "next/server";

// Mesma convenção que a Vercel usa nos próprios Cron Jobs (header "Authorization: Bearer
// $CRON_SECRET") — assim a rota aceita tanto um cron nativo da Vercel quanto um gatilho
// externo (ex: cron-job.org) configurado com o mesmo header.
export function verificarCronSecret(req: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET não configurado no servidor" }, { status: 500 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  return null;
}
