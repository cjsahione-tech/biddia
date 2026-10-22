import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCompany } from "@/lib/api-utils";

// Janela de alerta: documento do checklist com validade a até 2 dias de vencer (ou já
// vencido) vira uma notificação. Calculado ao vivo a partir de `validade` — não depende
// do campo `status` do item, que só é atualizado quando um agente roda.
const DIAS_ALERTA = 2;

export async function GET() {
  const { company, error } = await requireCompany();
  if (error) return error;

  const itens = await prisma.checklistItem.findMany({
    where: {
      edital: { companyId: company!.id },
      validade: { not: null },
    },
    include: { edital: { select: { id: true, titulo: true, orgaoNome: true } } },
    orderBy: { validade: "asc" },
  });

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  const notificacoes = itens
    .map((item) => {
      const validade = new Date(item.validade!);
      validade.setHours(0, 0, 0, 0);
      const diasRestantes = Math.round((validade.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24));
      return {
        id: item.id,
        editalId: item.edital.id,
        editalTitulo: item.edital.titulo,
        orgaoNome: item.edital.orgaoNome,
        documentoNome: item.documentoNome,
        validade: item.validade,
        diasRestantes,
        vencido: diasRestantes < 0,
      };
    })
    .filter((n) => n.diasRestantes <= DIAS_ALERTA)
    .sort((a, b) => a.diasRestantes - b.diasRestantes);

  // Auditorias de habilitação que pararam e só uma pessoa resolve (enviar arquivo, liberar custo...): aviso dentro do app.
  const comAcao = await prisma.edital.findMany({
    where: { companyId: company!.id, habilitacaoStatus: "PRECISA_ACAO_HUMANA" },
    select: { id: true, titulo: true, orgaoNome: true, auditoriaHabilitacao: { select: { mensagem: true, erroTipo: true } } },
    orderBy: { updatedAt: "desc" },
    take: 20,
  });
  const auditoriasComAcao = comAcao.map((e) => ({
    editalId: e.id,
    editalTitulo: e.titulo,
    orgaoNome: e.orgaoNome,
    mensagem: e.auditoriaHabilitacao?.mensagem ?? "A auditoria de habilitação parou e precisa da sua ajuda.",
  }));

  return NextResponse.json({ notificacoes, auditoriasComAcao });
}
