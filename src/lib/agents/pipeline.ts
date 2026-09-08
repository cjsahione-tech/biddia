import { executarAgente2 } from "@/lib/agents/agente2-analista";
import { executarAgente3 } from "@/lib/agents/agente3-financeiro";
import { executarAgente4 } from "@/lib/agents/agente4-advogado";
import { executarAgente5 } from "@/lib/agents/agente5-secretario";
import { executarAgente6 } from "@/lib/agents/agente6-auditor";
import { logAudit } from "@/lib/agents/run-tracker";

/**
 * Dispara a esteira completa (Analista → Financeiro → Advogado → Secretário → Auditor)
 * após o usuário aprovar um edital. Cada etapa é resiliente: uma falha não impede que
 * o Auditor rode ao final e tente corrigir o que faltou.
 */
export async function executarPipelineCompleto(editalId: string) {
  const etapas: Array<[string, () => Promise<unknown>]> = [
    ["Agente Analista", () => executarAgente2(editalId)],
    ["Agente Financeiro", () => executarAgente3(editalId)],
    ["Agente Advogado", () => executarAgente4(editalId)],
    ["Agente Secretário", () => executarAgente5(editalId)],
  ];

  for (const [nome, executar] of etapas) {
    try {
      await executar();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "erro desconhecido";
      await logAudit(editalId, nome, "Execução", "ERRO", `Falha na execução: ${msg}`);
    }
  }

  return executarAgente6(editalId);
}
