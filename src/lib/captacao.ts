import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { executarAgente1, type EstadoCaptacao } from "@/lib/agents/agente1-comercial";
import { descreverErro } from "@/lib/ia-erros";
import { notificarNovosEditais } from "@/lib/notifications";

// A busca varre o PNCP (as outras fontes ficam em fontes-captacao.ts), classifica com IA e cria os cards. Cada execução da
// Vercel cai em 60s e uma empresa pode ter centenas de editais para avaliar — então a busca é feita em ETAPAS: cada etapa
// trabalha por ~46s e, se sobrou trabalho, chama a próxima sozinha (com o que sobrou, sem refazer nada), até terminar.
// A primeira etapa roda em SEGUNDO PLANO (after): quem chama responde na hora com o registro da execução (CaptacaoRun) e a
// tela acompanha o progresso por GET /api/editais/search. Usado pelo botão "Buscar novos editais", pelo cadastro de um
// cliente novo na carteira do Analista e pela busca agendada (cron).

/** Quanto tempo uma etapa trabalha antes de passar a vez (a função da Vercel cai em 60s). */
export const ORCAMENTO_ETAPA_MS = 46_000;
/** Quantas etapas EXTRAS podem ser encadeadas (a Vercel recusa — HTTP 508 — correntes com mais de ~4 chamadas). */
export const MAX_ETAPAS_EXTRAS = 3;
/** Tamanho máximo do que uma etapa entrega à seguinte (o limite de corpo da Vercel é 4,5 MB). */
const TETO_CORPO_BYTES = 3_500_000;

// Execução "RUNNING" há mais que isso morreu junto com as funções serverless (a busca inteira leva até ~4 min) — não
// bloqueia uma nova busca nem fica pra sempre como "buscando" na tela.
const LIMITE_EXECUCAO_MS = 5 * 60_000;

export async function encerrarCaptacoesOrfas(companyId: string) {
  await prisma.captacaoRun.updateMany({
    where: { companyId, status: "RUNNING", startedAt: { lt: new Date(Date.now() - LIMITE_EXECUCAO_MS) } },
    data: {
      status: "ERROR",
      finishedAt: new Date(),
      mensagem:
        "A busca foi interrompida por ter passado do tempo limite — os editais já captados foram mantidos. Busque de novo para continuar de onde parou.",
    },
  });
}

export type PedidoDeEtapa = {
  companyId: string;
  runId: string;
  /** 0 = primeira etapa; 1..MAX_ETAPAS_EXTRAS = continuações. */
  etapa: number;
  /** O que sobrou da etapa anterior (ausente na primeira). */
  estado?: EstadoCaptacao;
  /** Avisar a empresa por e-mail/WhatsApp quando a busca terminar com editais novos (busca agendada). */
  notificar?: boolean;
};

/** Reduz o estado até caber no corpo de uma chamada; o que ficar de fora é achado de novo numa próxima busca. */
export function caberNoCorpo(pedido: PedidoDeEtapa, tetoBytes = TETO_CORPO_BYTES): { corpo: string; cortados: number } {
  let atual = pedido;
  let cortados = 0;
  let corpo = JSON.stringify(atual);
  while (corpo.length > tetoBytes && atual.estado && atual.estado.pendentesClassificar.length > 0) {
    const mantem = Math.floor(atual.estado.pendentesClassificar.length / 2);
    cortados += atual.estado.pendentesClassificar.length - mantem;
    atual = { ...atual, estado: { ...atual.estado, pendentesClassificar: atual.estado.pendentesClassificar.slice(0, mantem) } };
    corpo = JSON.stringify(atual);
  }
  return { corpo, cortados };
}

/** Chama a próxima etapa (a rota responde 202 na hora e trabalha em segundo plano). Tenta duas vezes. */
async function dispararEtapa(origin: string, pedido: PedidoDeEtapa): Promise<{ ok: boolean; cortados: number }> {
  const { corpo, cortados } = caberNoCorpo(pedido);
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    try {
      const res = await fetch(`${origin}/api/editais/search/continuar`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` },
        body: corpo,
      });
      if (res.ok) return { ok: true, cortados };
      console.error(`Captação: a próxima etapa respondeu HTTP ${res.status} (tentativa ${tentativa}).`);
    } catch (err) {
      console.error(`Captação: não foi possível chamar a próxima etapa (tentativa ${tentativa}):`, err);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return { ok: false, cortados };
}

async function avisarEmpresa(companyId: string, novos: number) {
  try {
    const empresa = await prisma.company.findUnique({
      where: { id: companyId },
      select: { razaoSocial: true, whatsapp: true, user: { select: { email: true } } },
    });
    if (empresa) await notificarNovosEditais({ email: empresa.user.email, whatsapp: empresa.whatsapp, razaoSocial: empresa.razaoSocial }, novos);
  } catch (err) {
    console.error(`Captação: falha ao avisar a empresa ${companyId} dos editais novos:`, err);
  }
}

/**
 * Executa UMA etapa da busca. `origin` é o endereço do próprio sistema (para chamar a etapa seguinte); sem ele a busca
 * termina nesta etapa, dizendo com honestidade se ainda havia editais para avaliar.
 */
export async function executarEtapaDaCaptacao(pedido: PedidoDeEtapa, origin?: string) {
  const { companyId, runId, etapa } = pedido;

  // Progresso sem sobrecarregar o banco: no máximo 1 gravação a cada ~1s.
  let ultimaGravacao = 0;
  const gravarProgresso = async (p: { fase: string; analisados: number; novos: number }) => {
    const agora = Date.now();
    if (agora - ultimaGravacao < 1000 && p.fase === "criando") return;
    ultimaGravacao = agora;
    await prisma.captacaoRun.update({ where: { id: runId }, data: { fase: p.fase, analisados: p.analisados, novos: p.novos } }).catch(() => {});
  };

  try {
    const resultado = await executarAgente1(companyId, gravarProgresso, { limiteMs: Date.now() + ORCAMENTO_ETAPA_MS, estado: pedido.estado });

    let mensagem = resultado.mensagem;
    if (resultado.estado) {
      // Sobrou trabalho: passa a vez para a próxima etapa (a busca continua RUNNING na tela).
      if (origin && etapa < MAX_ETAPAS_EXTRAS) {
        const proxima = await dispararEtapa(origin, { ...pedido, etapa: etapa + 1, estado: resultado.estado });
        if (proxima.ok) {
          await prisma.captacaoRun
            .update({ where: { id: runId }, data: { fase: "classificando", analisados: resultado.analisados, novos: resultado.novos } })
            .catch(() => {});
          return;
        }
      }
      // Sem como continuar agora: encerra dizendo a verdade e como seguir.
      const restantes = resultado.estado.pendentesClassificar.length + resultado.estado.pendentesCriar.length;
      mensagem = `${resultado.mensagem} Ainda restam cerca de ${restantes} edital(is) para avaliar — clique em "Buscar" de novo para continuar de onde parou.`;
    }

    await prisma.captacaoRun.update({
      where: { id: runId },
      data: { status: "DONE", fase: "concluida", analisados: resultado.analisados, novos: resultado.novos, mensagem, finishedAt: new Date() },
    });
    if (pedido.notificar && resultado.novos > 0) await avisarEmpresa(companyId, resultado.novos);
  } catch (err) {
    console.error(`Falha na busca do Agente Comercial (empresa ${companyId}, etapa ${etapa}):`, err);
    await prisma.captacaoRun
      .update({
        where: { id: runId },
        data: { status: "ERROR", mensagem: `Não foi possível concluir a busca: ${descreverErro(err)}.`, finishedAt: new Date() },
      })
      .catch(() => {});
  }
}

/**
 * Cria a execução e agenda a busca em segundo plano. Se já houver uma em andamento para a
 * empresa, devolve essa em vez de abrir outra. Precisa ser chamada dentro de uma requisição
 * (usa after()).
 */
export async function iniciarCaptacao(companyId: string, opcoes?: { origin?: string; notificar?: boolean }) {
  await encerrarCaptacoesOrfas(companyId);
  const emAndamento = await prisma.captacaoRun.findFirst({ where: { companyId, status: "RUNNING" } });
  if (emAndamento) return { run: emAndamento, jaEmAndamento: true };

  const run = await prisma.captacaoRun.create({ data: { companyId } });
  after(() => executarEtapaDaCaptacao({ companyId, runId: run.id, etapa: 0, notificar: opcoes?.notificar }, opcoes?.origin));
  return { run, jaEmAndamento: false };
}

/**
 * Para a busca agendada: abre a execução da empresa e entrega a primeira etapa a uma invocação PRÓPRIA (cada empresa
 * trabalha com os seus 60s, em paralelo às outras, em vez de todas dividirem os 60s da rota agendada).
 */
export async function dispararCaptacaoAgendada(companyId: string, origin: string): Promise<{ iniciada: boolean; motivo?: string }> {
  await encerrarCaptacoesOrfas(companyId);
  const emAndamento = await prisma.captacaoRun.findFirst({ where: { companyId, status: "RUNNING" } });
  if (emAndamento) return { iniciada: false, motivo: "já há uma busca em andamento" };

  const run = await prisma.captacaoRun.create({ data: { companyId } });
  const r = await dispararEtapa(origin, { companyId, runId: run.id, etapa: 0, notificar: true });
  if (!r.ok) {
    await prisma.captacaoRun
      .update({ where: { id: run.id }, data: { status: "ERROR", mensagem: "Não foi possível iniciar a busca agendada.", finishedAt: new Date() } })
      .catch(() => {});
    return { iniciada: false, motivo: "não foi possível iniciar" };
  }
  return { iniciada: true };
}
