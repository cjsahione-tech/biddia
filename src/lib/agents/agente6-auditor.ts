import { prisma } from "@/lib/prisma";
import { withAgentRun, logAudit } from "@/lib/agents/run-tracker";
import { executarAgente2 } from "@/lib/agents/agente2-analista";
import { executarAgente3 } from "@/lib/agents/agente3-financeiro";
import { executarAgente4 } from "@/lib/agents/agente4-advogado";
import { executarAgente5 } from "@/lib/agents/agente5-secretario";

/**
 * Agente Auditor Sênior — HEAD da equipe. Confere o resultado de cada agente e,
 * ao encontrar uma etapa ausente ou com erro, aciona novamente o agente responsável
 * como resolução imediata, registrando tudo em log de auditoria.
 */
export async function executarAgente6(editalId: string) {
  return withAgentRun(editalId, "agente6-auditor", async () => {
    const acoes: string[] = [];
    let severidadeFinal: "OK" | "ALERTA" | "ERRO" = "OK";

    const checar = async (
      nomeEtapa: string,
      existe: () => Promise<boolean>,
      corrigir: () => Promise<unknown>
    ) => {
      const ok = await existe();
      if (ok) return;

      severidadeFinal = "ALERTA";
      acoes.push(`${nomeEtapa} ausente — reexecutando o agente responsável.`);
      try {
        await corrigir();
        acoes.push(`${nomeEtapa} corrigido com sucesso após nova execução.`);
      } catch (err) {
        severidadeFinal = "ERRO";
        const msg = err instanceof Error ? err.message : "erro desconhecido";
        acoes.push(`Falha ao corrigir ${nomeEtapa.toLowerCase()}: ${msg}`);
      }
    };

    await checar(
      "Análise do edital (Agente Analista)",
      async () => !!(await prisma.analysis.findUnique({ where: { editalId } })),
      () => executarAgente2(editalId)
    );

    await checar(
      "Proposta financeira (Agente Financeiro)",
      async () => !!(await prisma.proposal.findUnique({ where: { editalId } })),
      () => executarAgente3(editalId)
    );

    await checar(
      "Anexos jurídicos (Agente Advogado)",
      async () => (await prisma.document.count({ where: { editalId } })) > 0,
      () => executarAgente4(editalId)
    );

    await checar(
      "Checklist de documentos (Agente Secretário)",
      async () => (await prisma.checklistItem.count({ where: { editalId } })) > 0,
      () => executarAgente5(editalId)
    );

    const checklistFaltante = await prisma.checklistItem.count({
      where: { editalId, obrigatorio: true, status: { in: ["FALTANTE", "VENCIDO"] } },
    });
    if (checklistFaltante > 0) {
      if (severidadeFinal === "OK") severidadeFinal = "ALERTA";
      acoes.push(
        `${checklistFaltante} documento(s) obrigatório(s) do checklist ainda dependem de envio pelo usuário — não é uma falha dos agentes, mas requer ação humana.`
      );
    }

    await logAudit(
      editalId,
      "Agente Auditor (HEAD)",
      "Auditoria geral do pipeline",
      severidadeFinal,
      acoes.length > 0
        ? acoes.join(" ")
        : "Todas as etapas do pipeline foram concluídas com sucesso e sem pendências.",
      acoes.length > 0 ? "Correções automáticas aplicadas quando possível." : undefined
    );

    return { severidade: severidadeFinal, acoes };
  });
}
