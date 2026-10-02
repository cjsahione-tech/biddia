import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { executarAgente2 } from "@/lib/agents/agente2-analista";
import { executarAgente3 } from "@/lib/agents/agente3-financeiro";
import { executarAgente4 } from "@/lib/agents/agente4-advogado";
import { executarAgente5 } from "@/lib/agents/agente5-secretario";
import { executarAgente6 } from "@/lib/agents/agente6-auditor";
import { baixarDocumentosPendentes } from "@/lib/agents/agente1-comercial";
import { prewarmTextoDocumentos } from "@/lib/agents/pdf-extract";
import { logAudit } from "@/lib/agents/run-tracker";
import { comRetry, descreverErro } from "@/lib/ia-erros";

/**
 * A esteira roda em ETAPAS SEQUENCIAIS, cada uma numa invocação serverless própria (com o
 * teto de 60s só pra ela): Analista → Financeiro → Advogado → Secretário → Auditor. A
 * ordem não é só organização — Financeiro e Advogado leem o resumo do Analista, e o
 * Secretário monta o checklist a partir da habilitação que o Analista extraiu; em
 * paralelo, eles frequentemente rodavam ANTES da análise existir e trabalhavam sem ela.
 * Rodar um por vez também elimina o problema de dividir o mesmo orçamento de tempo (e a
 * mesma cota de tokens por minuto da IA) entre agentes simultâneos.
 */
export const ETAPAS_PIPELINE = ["analista", "financeiro", "advogado", "secretario", "auditor"] as const;
export type EtapaPipeline = (typeof ETAPAS_PIPELINE)[number];

export function isEtapaPipeline(v: string): v is EtapaPipeline {
  return (ETAPAS_PIPELINE as readonly string[]).includes(v);
}

const DEFINICAO_ETAPA: Record<EtapaPipeline, { nome: string; executar: (editalId: string) => Promise<unknown> }> = {
  analista: { nome: "Agente Analista", executar: (id) => executarAgente2(id) },
  financeiro: { nome: "Agente Financeiro", executar: (id) => executarAgente3(id) },
  advogado: { nome: "Agente Advogado", executar: (id) => executarAgente4(id) },
  secretario: { nome: "Agente Secretário", executar: (id) => executarAgente5(id) },
  auditor: { nome: "Agente Auditor", executar: (id) => executarAgente6(id) },
};

export function proximaEtapa(etapa: EtapaPipeline): EtapaPipeline | null {
  const i = ETAPAS_PIPELINE.indexOf(etapa);
  return ETAPAS_PIPELINE[i + 1] ?? null;
}

// Teto de espera de UM agente antes de seguir pra próxima etapa: a função serverless morre
// em 60s, então estoura aqui um pouco antes pra ainda conseguir disparar a continuação (o
// Auditor, no final, detecta o que ficou pendente e reexecuta).
const ESPERA_MAXIMA_MS = 52_000;

/**
 * Executa UMA etapa com tratamento de falha explícito: tenta de novo sozinho quando o erro
 * é passageiro (sobrecarga/limite de taxa/resposta da IA fora do formato), registra cada
 * tentativa na aba Auditoria e — se mesmo assim falhar — registra o erro com o motivo em
 * português. Nunca lança: uma falha num agente não pode travar a esteira inteira; o
 * Auditor, no fim, enxerga o que ficou faltando e tenta reexecutar.
 */
export async function executarEtapa(editalId: string, etapa: EtapaPipeline): Promise<void> {
  const { nome, executar } = DEFINICAO_ETAPA[etapa];

  const timeout = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), ESPERA_MAXIMA_MS));
  const execucao = comRetry(() => executar(editalId), {
    tentativas: etapa === "auditor" ? 1 : 3,
    esperaMs: 3000,
    aoFalhar: async (err, tentativa) => {
      await logAudit(
        editalId,
        nome,
        "Nova tentativa automática",
        "ALERTA",
        `A tentativa ${tentativa} falhou por instabilidade (${descreverErro(err)}) — tentando de novo automaticamente.`
      ).catch(() => {});
    },
  }).then(
    () => "ok" as const,
    async (err) => {
      console.error(`Etapa "${etapa}" do pipeline do edital ${editalId} falhou:`, err);
      await logAudit(
        editalId,
        nome,
        "Execução",
        "ERRO",
        `Falha na execução: ${descreverErro(err)}. A esteira seguiu para as próximas etapas; o Agente Auditor vai tentar refazer o que ficou faltando.`
      ).catch(() => {});
      return "erro" as const;
    }
  );

  const resultado = await Promise.race([execucao, timeout]);
  if (resultado === "timeout") {
    await logAudit(
      editalId,
      nome,
      "Execução",
      "ALERTA",
      "Esta etapa está demorando mais que o limite de uma execução — a esteira seguiu para a próxima etapa e o Agente Auditor confere o resultado no final."
    ).catch(() => {});
  }
}

/**
 * Primeira etapa: baixa (com retry) e extrai o texto de todos os documentos pendentes do
 * edital — sem prazo compartilhado com nenhuma chamada de IA, pra nunca analisar com PDF
 * incompleto sem deixar rastro (baixarDocumentosPendentes já registra um logAudit de
 * ALERTA quando algum anexo não baixa mesmo após tentar de novo).
 */
export async function baixarEExtrairDocumentos(editalId: string) {
  await baixarDocumentosPendentes([editalId]);
  await prewarmTextoDocumentos(editalId);
}

/** Dispara a invocação de uma etapa. Confere a resposta HTTP (antes só a falha de rede
 * era tratada — uma resposta 401/404/500 passava em silêncio e a esteira simplesmente
 * parava) e tenta mais uma vez antes de registrar o problema na aba Auditoria. */
export async function dispararEtapa(origin: string, cookie: string, editalId: string, etapa: EtapaPipeline) {
  let ultimoErro = "";
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    try {
      const res = await fetch(`${origin}/api/editais/${editalId}/pipeline/${etapa}`, {
        method: "POST",
        headers: { cookie },
      });
      if (res.ok) return;
      ultimoErro = `resposta HTTP ${res.status}`;
    } catch (err) {
      ultimoErro = err instanceof Error ? err.message : "erro de rede";
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  console.error(`Não foi possível disparar a etapa "${etapa}" do edital ${editalId}: ${ultimoErro}`);
  await logAudit(
    editalId,
    "Pipeline",
    "Encadeamento das etapas",
    "ERRO",
    `A esteira parou antes da etapa "${DEFINICAO_ETAPA[etapa].nome}": não foi possível iniciá-la (${ultimoErro}). Mova o card de etapa novamente para retomar.`
  ).catch(() => {});
}

/**
 * Decide se vale disparar a esteira para este edital. Mover o card pra "Qualificação"
 * várias vezes NÃO pode refazer tudo à toa: reexecutar o Financeiro sobrescreve edições
 * manuais de preço e a seleção de lotes, e cada execução gasta chamadas de IA. Roda se
 * algo ainda não foi concluído com sucesso; pula se já está rodando ou já está completo.
 */
export async function decidirDisparoPipeline(
  editalId: string
): Promise<{ rodar: boolean; motivo: string }> {
  const recente = new Date(Date.now() - 4 * 60 * 1000);
  const [rodando, analysis, proposal, advogadoOk, checklist, auditorOk] = await Promise.all([
    prisma.agentRun.count({ where: { editalId, status: "RUNNING", startedAt: { gt: recente } } }),
    prisma.analysis.findUnique({ where: { editalId }, select: { baseadoEmTextoCompleto: true } }),
    prisma.proposal.findUnique({ where: { editalId }, select: { baseadoEmTextoCompleto: true } }),
    prisma.agentRun.count({ where: { editalId, agentKey: "agente4-advogado", status: "DONE" } }),
    prisma.checklistItem.count({ where: { editalId } }),
    prisma.agentRun.count({ where: { editalId, agentKey: "agente6-auditor", status: "DONE" } }),
  ]);

  if (rodando > 0) return { rodar: false, motivo: "a esteira já está em andamento para este edital" };

  const completo =
    !!analysis?.baseadoEmTextoCompleto && !!proposal?.baseadoEmTextoCompleto && advogadoOk > 0 && checklist > 0 && auditorOk > 0;
  if (completo) {
    return {
      rodar: false,
      motivo: "a análise deste edital já foi concluída (reexecutar apagaria edições manuais — use o chat de cada agente para pedir ajustes)",
    };
  }
  return { rodar: true, motivo: "há etapas ainda não concluídas" };
}

/**
 * Dispara a esteira em segundo plano (após a resposta HTTP já ter sido enviada): primeiro
 * baixa/extrai os documentos e então encadeia as etapas sequenciais, cada uma como uma
 * nova chamada HTTP pra ganhar seu próprio orçamento de execução na Vercel. Reaproveitado
 * pela movimentação no quadro, pela aprovação de um edital e pela captação manual de PDF.
 */
export function dispararPipeline(editalId: string, req: Request) {
  const cookie = req.headers.get("cookie") ?? "";
  const origin = new URL(req.url).origin;

  after(async () => {
    try {
      await baixarEExtrairDocumentos(editalId);
    } catch (err) {
      console.error(`Falha ao baixar/extrair documentos do edital ${editalId}:`, err);
      await logAudit(
        editalId,
        "Pipeline",
        "Download dos documentos",
        "ALERTA",
        `Não foi possível baixar/ler os documentos do edital (${descreverErro(err)}) — as análises seguem com o que estiver disponível.`
      ).catch(() => {});
    }
    await dispararEtapa(origin, cookie, editalId, ETAPAS_PIPELINE[0]);
  });
}
