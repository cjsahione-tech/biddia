import { after } from "next/server";
import { executarAgente2 } from "@/lib/agents/agente2-analista";
import { executarAgente3 } from "@/lib/agents/agente3-financeiro";
import { executarAgente4 } from "@/lib/agents/agente4-advogado";
import { baixarDocumentosPendentes } from "@/lib/agents/agente1-comercial";
import { prewarmTextoDocumentos } from "@/lib/agents/pdf-extract";
import { logAudit } from "@/lib/agents/run-tracker";

/**
 * Primeira etapa da esteira: Analista, Financeiro e Advogado rodam em paralelo — cada
 * um lê o texto do edital/TR de forma independente, então não precisam esperar um pelo
 * outro. A continuação (Secretário → Auditor) roda numa segunda invocação separada
 * (ver /api/editais/[id]/continuar-pipeline), para não disputar o mesmo orçamento de
 * execução da Vercel.
 */
export async function executarPipelineCompleto(editalId: string) {
  // O Agente Comercial só guarda o link dos PDFs na captação e baixa em segundo plano;
  // aqui garante que o conteúdo esteja em mãos antes de os agentes lerem, sem cada um
  // rebaixar o mesmo arquivo do PNCP.
  await baixarDocumentosPendentes([editalId]);
  // Extrai o texto de todos os PDFs uma única vez; os 3 agentes abaixo leem do cache
  // em vez de reprocessar o mesmo arquivo cada um.
  await prewarmTextoDocumentos(editalId);

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
 * Dispara o pipeline completo em segundo plano (após a resposta HTTP já ter sido
 * enviada) e, em seguida, aciona a continuação (Secretário → Auditor) como uma nova
 * chamada HTTP, para que ela ganhe seu próprio orçamento de execução na Vercel.
 * Reaproveitado tanto pela aprovação de um edital encontrado pelo Agente Comercial
 * quanto pela captação manual de um PDF pelo usuário.
 */
export function dispararPipeline(editalId: string, req: Request) {
  const cookie = req.headers.get("cookie") ?? "";
  const origin = new URL(req.url).origin;

  after(async () => {
    // Espera o lote paralelo até 52s: se algum agente estiver demorando muito (edital
    // grande), ainda assim dispara a continuação dentro do teto de 60s da Vercel — o
    // Auditor, na segunda chamada, aguarda um agente ainda em execução antes de decidir
    // reexecutá-lo.
    const timeout = new Promise((resolve) => setTimeout(resolve, 52_000));
    try {
      await Promise.race([executarPipelineCompleto(editalId), timeout]);
    } catch (err) {
      console.error(`Falha no pipeline do edital ${editalId}:`, err);
    }

    try {
      await fetch(`${origin}/api/editais/${editalId}/continuar-pipeline`, {
        method: "POST",
        headers: { cookie },
      });
    } catch (err) {
      console.error(`Falha ao disparar a continuação do pipeline do edital ${editalId}:`, err);
    }
  });
}
