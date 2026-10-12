import { NextResponse } from "next/server";
import { verificarCronSecret } from "@/lib/cron-auth";
import { vigiarAuditorias } from "@/lib/agents/auditoria-fila";

// Vigia das auditorias de habilitação: interrompe e re-enfileira as que travaram, reenvia as
// que têm nova tentativa vencida, retoma as guardadas por falta de saldo (quando a IA volta) e
// preenche as vagas da fila. OPCIONAL: o vigia também roda sozinho quando alguém abre o quadro
// ou a aba Habilitação e ao fim de cada auditoria; este endpoint só cobre o caso de ninguém
// estar com o sistema aberto. Chamada a cada ~5 minutos pelo mesmo agendador externo da busca
// de editais (mesmo CRON_SECRET no cabeçalho Authorization).
export const maxDuration = 60;

export async function GET(req: Request) {
  const naoAutorizado = verificarCronSecret(req);
  if (naoAutorizado) return naoAutorizado;

  const resumo = await vigiarAuditorias({ origem: new URL(req.url).origin, forcar: true });
  return NextResponse.json(resumo);
}
