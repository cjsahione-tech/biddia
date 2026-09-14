import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verificarCronSecret } from "@/lib/cron-auth";
import { executarAgente1 } from "@/lib/agents/agente1-comercial";
import { mapComLimite } from "@/lib/concorrencia";
import { notificarNovosEditais } from "@/lib/notifications";

// Roda o Agente Comercial para todas as empresas com alguma fonte de busca configurada
// (palavras-chave do PNCP e/ou segmento do LicitaNet) e notifica por e-mail/WhatsApp
// quando aparece edital novo. Chamada duas vezes ao dia (8:30 e 15:30 horário de
// Brasília) por um agendador externo, já que Cron Jobs nativos da Vercel no plano Hobby
// só rodam 1x/dia — ver instruções de configuração no README de deploy.
export const maxDuration = 60;

export async function GET(req: Request) {
  const naoAutorizado = verificarCronSecret(req);
  if (naoAutorizado) return naoAutorizado;

  const empresas = await prisma.company.findMany({
    where: { OR: [{ keywords: { some: {} } }, { licitanetSegmentoId: { not: null } }] },
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

  return NextResponse.json({
    empresasProcessadas: resultados.length,
    totalNovos: resultados.reduce((acc, r) => acc + r.novos, 0),
    resultados,
  });
}
