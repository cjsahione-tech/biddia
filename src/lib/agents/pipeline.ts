import { after } from "next/server";
import { executarAgente2 } from "@/lib/agents/agente2-analista";
import { executarAgente3 } from "@/lib/agents/agente3-financeiro";
import { executarAgente4 } from "@/lib/agents/agente4-advogado";
import { baixarDocumentosPendentes } from "@/lib/agents/agente1-comercial";
import { prewarmTextoDocumentos } from "@/lib/agents/pdf-extract";
import { logAudit } from "@/lib/agents/run-tracker";

/**
 * Primeira etapa da esteira: baixa (com retry) e extrai o texto de todos os documentos
 * pendentes do edital — sem prazo compartilhado com nenhuma chamada de IA, pra nunca
 * analisar com PDF incompleto sem deixar rastro (baixarDocumentosPendentes já registra
 * um logAudit de ALERTA quando algum anexo não baixa mesmo após tentar de novo).
 */
export async function baixarEExtrairDocumentos(editalId: string) {
  await baixarDocumentosPendentes([editalId]);
  await prewarmTextoDocumentos(editalId);
}

/**
 * Segunda etapa: Analista, Financeiro e Advogado rodam em paralelo — cada um lê o texto
 * do edital/TR de forma independente, então não precisam esperar um pelo outro. Só é
 * chamada depois que o texto já está garantido em mãos (baixarEExtrairDocumentos) — a
 * continuação (Secretário → Auditor) roda numa terceira invocação separada (ver
 * /api/editais/[id]/continuar-pipeline), para não disputar o mesmo orçamento de
 * execução da Vercel.
 */
export async function executarAnaliseIA(editalId: string) {
  const etapasParalelas: Array<[string, () => Promise<unknown>]> = [
    ["Agente Analista", () => executarAgente2(editalId)],
    ["Agente Financeiro", () => executarAgente3(editalId)],
    ["Agente Advogado", () => executarAgente4(editalId)],
  ];

  const resultados = await Promise.allSettled(etapasParalelas.map(([, executar]) => executar()));
  for (const [i, resultado] of resultados.entries()) {
    if (resultado.status === "rejected") {
      const [nome] = etapasParalelas[i];
      const msg = resultado.reason instanceof Error ? resultado.reason.message : "erro desconhecido";
      await logAudit(editalId, nome, "Execução", "ERRO", `Falha na execução: ${msg}`);
    }
  }
}

/**
 * Dispara o download/extração em segundo plano (após a resposta HTTP já ter sido
 * enviada) e, em seguida, aciona a etapa de análise por IA como uma nova chamada HTTP,
 * para que ela ganhe seu próprio orçamento de execução na Vercel — o download roda até
 * o fim (com retry) sem disputar tempo com IA nenhuma. Reaproveitado tanto pela
 * aprovação de um edital encontrado pelo Agente Comercial quanto pela captação manual
 * de um PDF pelo usuário.
 */
export function dispararPipeline(editalId: string, req: Request) {
  const cookie = req.headers.get("cookie") ?? "";
  const origin = new URL(req.url).origin;

  after(async () => {
    try {
      await baixarEExtrairDocumentos(editalId);
    } catch (err) {
      console.error(`Falha ao baixar/extrair documentos do edital ${editalId}:`, err);
    }

    try {
      await fetch(`${origin}/api/editais/${editalId}/continuar-pipeline-analise`, {
        method: "POST",
        headers: { cookie },
      });
    } catch (err) {
      console.error(`Falha ao disparar a etapa de análise do pipeline do edital ${editalId}:`, err);
    }
  });
}
