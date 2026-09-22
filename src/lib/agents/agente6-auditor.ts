import { prisma } from "@/lib/prisma";
import { withAgentRun, logAudit } from "@/lib/agents/run-tracker";
import { executarAgente2 } from "@/lib/agents/agente2-analista";
import { executarAgente3 } from "@/lib/agents/agente3-financeiro";
import { executarAgente4 } from "@/lib/agents/agente4-advogado";
import { executarAgente5 } from "@/lib/agents/agente5-secretario";
import { baixarDocumentosPendentes } from "@/lib/agents/agente1-comercial";
import { prewarmTextoDocumentos } from "@/lib/agents/pdf-extract";

/**
 * Agente Auditor Sênior — HEAD da equipe. Confere o resultado de cada agente e,
 * ao encontrar uma etapa ausente ou com erro, aciona novamente o agente responsável
 * como resolução imediata, registrando tudo em log de auditoria.
 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function executarAgente6(editalId: string) {
  return withAgentRun(editalId, "agente6-auditor", async () => {
    const acoes: string[] = [];
    let severidadeFinal: "OK" | "ALERTA" | "ERRO" = "OK";

    const checar = async (
      nomeEtapa: string,
      agentKey: string,
      existe: () => Promise<boolean>,
      corrigir: () => Promise<unknown>
    ) => {
      if (await existe()) return;

      // O resultado pode estar só a segundos de aparecer (o agente terminou a invocação
      // anterior bem em cima do limite). Se há uma execução recente ainda marcada como
      // RUNNING, dá uma janela curta antes de gastar uma nova execução refazendo tudo.
      const rodandoRecente = await prisma.agentRun.findFirst({
        where: {
          editalId,
          agentKey,
          status: "RUNNING",
          startedAt: { gt: new Date(Date.now() - 55_000) },
        },
      });
      if (rodandoRecente) {
        for (let i = 0; i < 2; i++) {
          await sleep(6_000);
          if (await existe()) {
            acoes.push(`${nomeEtapa}: concluído pelo agente que já estava em execução.`);
            return;
          }
        }
      }

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
      "agente2-analista",
      async () => {
        const a = await prisma.analysis.findUnique({ where: { editalId } });
        // baseadoEmTextoCompleto: false significa que a análise rodou sem o PDF
        // completo (ver dispararPipeline em pipeline.ts) — trata como pendente, não só
        // "já existe", pra dar uma segunda chance ao download antes de aceitar.
        return !!a && a.baseadoEmTextoCompleto;
      },
      async () => {
        await baixarDocumentosPendentes([editalId]); // idempotente: só retenta o que falhou
        await prewarmTextoDocumentos(editalId);
        return executarAgente2(editalId);
      }
    );

    await checar(
      "Proposta financeira (Agente Financeiro)",
      "agente3-financeiro",
      async () => {
        const p = await prisma.proposal.findUnique({ where: { editalId } });
        return !!p && p.baseadoEmTextoCompleto;
      },
      async () => {
        await baixarDocumentosPendentes([editalId]);
        await prewarmTextoDocumentos(editalId);
        return executarAgente3(editalId);
      }
    );

    await checar(
      "Anexos jurídicos (Agente Advogado)",
      "agente4-advogado",
      // Não checa mais "gerou algum documento": um edital sem nenhum modelo de
      // declaração reproduzível no texto legitimamente não gera anexo nenhum agora —
      // o que importa é só se o agente já rodou até o fim para este edital.
      async () =>
        (await prisma.agentRun.count({ where: { editalId, agentKey: "agente4-advogado", status: "DONE" } })) > 0,
      () => executarAgente4(editalId)
    );

    await checar(
      "Checklist de documentos (Agente Advogado)",
      "agente5-secretario",
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
