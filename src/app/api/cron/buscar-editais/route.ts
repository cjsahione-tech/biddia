import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verificarCronSecret } from "@/lib/cron-auth";
import { executarAgente1 } from "@/lib/agents/agente1-comercial";
import { mapComLimite } from "@/lib/concorrencia";
import { vigiarAuditorias } from "@/lib/agents/auditoria-fila";
import { notificarNovosEditais } from "@/lib/notifications";
import { excluirRascunhosVencidos } from "@/lib/rascunho-expiracao";
import { repararEditais } from "@/lib/agents/edital-disponivel";
import { fonteAtiva } from "@/lib/fontes-captacao";

// Roda o Agente Comercial para todas as empresas com alguma fonte de busca configurada
// (palavras-chave do PNCP; segmento do LicitaNet só se essa fonte estiver ligada em fontes-captacao.ts) e notifica por e-mail/WhatsApp
// quando aparece edital novo. Chamada duas vezes ao dia (8:30 e 15:30 horário de
// Brasília) por um agendador externo, já que Cron Jobs nativos da Vercel no plano Hobby
// só rodam 1x/dia — ver instruções de configuração no README de deploy.
export const maxDuration = 60;

export async function GET(req: Request) {
  const naoAutorizado = verificarCronSecret(req);
  if (naoAutorizado) return naoAutorizado;

  const empresas = await prisma.company.findMany({
    where: fonteAtiva("LICITANET")
      ? { OR: [{ keywords: { some: {} } }, { licitanetSegmentoId: { not: null } }] }
      : { keywords: { some: {} } },
    select: {
      id: true,
      razaoSocial: true,
      whatsapp: true,
      user: { select: { email: true } },
    },
  });

  const resultados: { companyId: string; novos: number; erro?: string }[] = [];

  await mapComLimite(empresas, 3, async (empresa) => {
    try {
      const resultado = await executarAgente1(empresa.id);
      resultados.push({ companyId: empresa.id, novos: resultado.novos });
      if (resultado.novos > 0) {
        await notificarNovosEditais(
          { email: empresa.user.email, whatsapp: empresa.whatsapp, razaoSocial: empresa.razaoSocial },
          resultado.novos
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      console.error(`[cron/buscar-editais] Falha na empresa ${empresa.id}:`, err);
      resultados.push({ companyId: empresa.id, novos: 0, erro: msg });
    }
  });

  // Vigia: auditorias de habilitação travadas, com nova tentativa vencida ou guardadas por falta de saldo.
  const vigia = await vigiarAuditorias({ origem: new URL(req.url).origin, forcar: true }).catch(() => null);

  // Limpeza: rascunhos com mais de 7 dias saem da base (o tempo que sobra da busca é usado aqui).
  const limpeza = await excluirRascunhosVencidos({ ateMs: 10_000 }).catch(() => null);
  // Completa os editais captados (arquivos, edital principal no Storage, valor) com o tempo que sobrou.
  const reparo = await repararEditais({ limite: 30, ateMs: 15_000 }).catch(() => null);
  // Histórico de consumo de IA: guarda 60 dias (o painel de saúde olha no máximo 90, mas 60 já cobre a rotina).
  await prisma.consumoIA.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 60 * 24 * 3_600_000) } } }).catch(() => null);

  return NextResponse.json({
    vigia,
    limpezaRascunhos: limpeza,
    reparoEditais: reparo,
    empresasProcessadas: resultados.length,
    totalNovos: resultados.reduce((acc, r) => acc + r.novos, 0),
    resultados,
  });
}
