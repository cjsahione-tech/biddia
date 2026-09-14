import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verificarCronSecret } from "@/lib/cron-auth";
import { notificarPrazosVencendo } from "@/lib/notifications";

// Mesma janela de alerta da tela de Notificações (2 dias, ou já vencido). "Hoje" aqui
// significa o mesmo dia civil em que o cron rodou — evita reenviar o mesmo aviso na
// segunda execução do dia (15:30) sobre um item já avisado às 8:30.
const DIAS_ALERTA = 2;

export const maxDuration = 60;

export async function GET(req: Request) {
  const naoAutorizado = verificarCronSecret(req);
  if (naoAutorizado) return naoAutorizado;

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const inicioDoDia = hoje;

  const itens = await prisma.checklistItem.findMany({
    where: {
      validade: { not: null },
      OR: [{ ultimoAlertaEnviadoEm: null }, { ultimoAlertaEnviadoEm: { lt: inicioDoDia } }],
    },
    include: {
      edital: {
        select: {
          titulo: true,
          company: {
            select: { id: true, razaoSocial: true, whatsapp: true, user: { select: { email: true } } },
          },
        },
      },
    },
  });

  const porEmpresa = new Map<
    string,
    {
      empresa: { id: string; razaoSocial: string; whatsapp: string | null; email: string };
      itens: { id: string; documentoNome: string; editalTitulo: string; diasRestantes: number }[];
    }
  >();

  for (const item of itens) {
    const validade = new Date(item.validade!);
    validade.setHours(0, 0, 0, 0);
    const diasRestantes = Math.round((validade.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24));
    if (diasRestantes > DIAS_ALERTA) continue;

    const empresaId = item.edital.company.id;
    if (!porEmpresa.has(empresaId)) {
      porEmpresa.set(empresaId, {
        empresa: {
          id: empresaId,
          razaoSocial: item.edital.company.razaoSocial,
          whatsapp: item.edital.company.whatsapp,
          email: item.edital.company.user.email,
        },
        itens: [],
      });
    }
    porEmpresa.get(empresaId)!.itens.push({
      id: item.id,
      documentoNome: item.documentoNome,
      editalTitulo: item.edital.titulo,
      diasRestantes,
    });
  }

  const agora = new Date();
  for (const { empresa, itens: itensEmpresa } of porEmpresa.values()) {
    await notificarPrazosVencendo(empresa, itensEmpresa);
    await prisma.checklistItem.updateMany({
      where: { id: { in: itensEmpresa.map((i) => i.id) } },
      data: { ultimoAlertaEnviadoEm: agora },
    });
  }

  return NextResponse.json({
    empresasNotificadas: porEmpresa.size,
    totalItens: [...porEmpresa.values()].reduce((acc, e) => acc + e.itens.length, 0),
  });
}
