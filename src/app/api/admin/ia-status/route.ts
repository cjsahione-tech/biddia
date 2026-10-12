import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { lerEstadoIA } from "@/lib/controle-ia";
import { classificarErro, ErroTipado } from "@/lib/ia-erros";
import { prisma } from "@/lib/prisma";

// Estado do "disjuntor" da IA, só para administrador: a faixa de aviso no topo do app usa isto.
// O analista comum nunca recebe o motivo técnico (saldo/chave) — só o texto amigável nas telas.
export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  const estado = await lerEstadoIA();
  if (!estado.pausada || !estado.motivo) return NextResponse.json({ pausada: false });

  const aguardando = await prisma.auditoriaHabilitacao.count({ where: { estado: "AGUARDANDO_SALDO" } });
  const c = classificarErro(new ErroTipado(estado.motivo, ""));
  return NextResponse.json({
    pausada: true,
    motivo: estado.motivo,
    aviso: c.mensagemAdmin,
    desde: estado.desde?.toISOString() ?? null,
    proximaChecagem: estado.pausadaAte?.toISOString() ?? null,
    auditoriasGuardadas: aguardando,
  });
}
