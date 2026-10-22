import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { LISTA_ETAPAS_QUE_AUDITAM } from "@/lib/habilitacao";
import { TETO_CUSTO_LIBERADO_USD, TETO_CUSTO_POR_EDITAL_USD } from "@/lib/auditoria-politica";
import { META_TERMINAR_SOZINHA, resumirSaudeAuditorias, type TentativaLog } from "@/lib/saude-auditorias";

// Painel "Saúde das auditorias" (só administrador): o que aconteceu com as auditorias de habilitação nos últimos dias.
// Só leitura: nada aqui reprocessa nem chama a IA.
export async function GET(req: Request) {
  const { error } = await requireAdmin();
  if (error) return error;

  const dias = Math.min(60, Math.max(1, Number(new URL(req.url).searchParams.get("dias")) || 7));
  const desde = new Date(Date.now() - dias * 24 * 3_600_000);

  const auditorias = await prisma.auditoriaHabilitacao.findMany({
    where: { updatedAt: { gte: desde }, edital: { etapaKanban: { in: [...LISTA_ETAPAS_QUE_AUDITAM] } } },
    select: {
      estado: true,
      leituraCompleta: true,
      proximaTentativaEm: true,
      erroTipo: true,
      custoUsd: true,
      iniciadaEm: true,
      concluidaEm: true,
      updatedAt: true,
      edital: { select: { habilitacaoStatus: true } },
    },
  });

  // O registro de tentativas é uma tabela nova: se ainda não existir no banco, o painel segue só com o estado das auditorias.
  let tentativas: TentativaLog[] = [];
  let registroDisponivel = true;
  try {
    tentativas = await prisma.auditoriaTentativa.findMany({
      where: { criadaEm: { gte: desde } },
      select: { resultado: true, tipoErro: true, metodo: true, duracaoMs: true, custoUsd: true },
    });
  } catch {
    registroDisponivel = false;
  }

  const resumo = resumirSaudeAuditorias(
    auditorias.map((a) => ({
      estado: a.estado,
      statusEdital: a.edital.habilitacaoStatus,
      leituraCompleta: a.leituraCompleta,
      retentativaAgendada: a.estado === "ERRO" && !!a.proximaTentativaEm,
      erroTipo: a.erroTipo,
      custoUsd: a.custoUsd,
      iniciadaEm: a.iniciadaEm,
      concluidaEm: a.concluidaEm,
      updatedAt: a.updatedAt,
    })),
    tentativas,
    { tetoCustoUsd: TETO_CUSTO_POR_EDITAL_USD }
  );

  return NextResponse.json({
    dias,
    meta: META_TERMINAR_SOZINHA,
    tetoCustoUsd: TETO_CUSTO_POR_EDITAL_USD,
    tetoCustoLiberadoUsd: TETO_CUSTO_LIBERADO_USD,
    registroDisponivel,
    ...resumo,
  });
}
