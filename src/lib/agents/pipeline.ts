import { after } from "next/server";
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
    // Não espera o lote paralelo além de 45s: se algum agente estiver demorando muito
    // (edital grande), ainda assim dispara a continuação dentro do teto de 60s da
    // Vercel — o Auditor, na segunda chamada, re-executa o que não tiver terminado.
    const timeout = new Promise((resolve) => setTimeout(resolve, 45_000));
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
