import { executarAgente2 } from "@/lib/agents/agente2-analista";
import { executarAgente3 } from "@/lib/agents/agente3-financeiro";
import { executarAgente4 } from "@/lib/agents/agente4-advogado";
import { executarAgente5 } from "@/lib/agents/agente5-secretario";
import { executarAgente6 } from "@/lib/agents/agente6-auditor";
import { logAudit } from "@/lib/agents/run-tracker";

/**
 * Dispara a esteira completa (Analista + Financeiro + Advogado → Secretário → Auditor)
 * após o usuário aprovar um edital. Analista, Financeiro e Advogado rodam em paralelo —
 * cada um lê o texto do edital/TR de forma independente, então não precisam esperar um
 * pelo outro — o que também mantém o tempo total dentro do limite de execução da Vercel.
 * Cada etapa é resiliente: uma falha não impede que o Auditor rode ao final e tente
 * corrigir o que faltou.
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

  try {
    await executarAgente5(editalId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "erro desconhecido";
    await logAudit(editalId, "Agente Secretário", "Execução", "ERRO", `Falha na execução: ${msg}`);
  }

  return executarAgente6(editalId);
}
