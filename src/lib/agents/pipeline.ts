import { executarAgente2 } from "@/lib/agents/agente2-analista";
import { executarAgente3 } from "@/lib/agents/agente3-financeiro";
import { executarAgente4 } from "@/lib/agents/agente4-advogado";
import { logAudit } from "@/lib/agents/run-tracker";

/**
 * Primeira etapa da esteira: Analista, Financeiro e Advogado rodam em paralelo — cada
 * um lê o texto do edital/TR de forma independente, então não precisam esperar um pelo
 * outro. A continuação (Secretário → Auditor) roda numa segunda invocação separada
 * (ver /api/editais/[id]/continuar-pipeline), para não disputar o mesmo orçamento de
 * execução da Vercel.
 */
export async function executarPipelineCompleto(editalId: string) {
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
