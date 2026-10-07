import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { executarAgente1 } from "@/lib/agents/agente1-comercial";
import { descreverErro } from "@/lib/ia-erros";

// A busca varre PNCP/LicitaNet/Compras.gov.br, classifica com IA e cria os cards — pode
// levar quase o teto de 60s da Vercel. Por isso roda em SEGUNDO PLANO (after): quem chama
// responde na hora com o registro da execução (CaptacaoRun) e a tela acompanha o progresso
// por GET /api/editais/search. Usado pelo botão "Buscar novos editais" e pelo cadastro de
// um cliente novo na carteira do Analista (a busca já começa sem nenhuma configuração extra).

// Execução "RUNNING" há mais que isso morreu junto com a função serverless (60s) — não
// bloqueia uma nova busca nem fica pra sempre como "buscando" na tela.
const LIMITE_EXECUCAO_MS = 75_000;

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

/**
 * Cria a execução e agenda a busca em segundo plano. Se já houver uma em andamento para a
 * empresa, devolve essa em vez de abrir outra. Precisa ser chamada dentro de uma requisição
 * (usa after()).
 */
export async function iniciarCaptacao(companyId: string) {
  await encerrarCaptacoesOrfas(companyId);
  const emAndamento = await prisma.captacaoRun.findFirst({ where: { companyId, status: "RUNNING" } });
  if (emAndamento) return { run: emAndamento, jaEmAndamento: true };

  const run = await prisma.captacaoRun.create({ data: { companyId } });

  after(async () => {
    // Progresso sem sobrecarregar o banco: no máximo 1 gravação a cada ~1s.
    let ultimaGravacao = 0;
    const gravarProgresso = async (p: { fase: string; analisados: number; novos: number }) => {
      const agora = Date.now();
      if (agora - ultimaGravacao < 1000 && p.fase === "criando") return;
      ultimaGravacao = agora;
      await prisma.captacaoRun
        .update({ where: { id: run.id }, data: { fase: p.fase, analisados: p.analisados, novos: p.novos } })
        .catch(() => {});
    };

    try {
      const resultado = await executarAgente1(companyId, gravarProgresso);
      await prisma.captacaoRun.update({
        where: { id: run.id },
        data: {
          status: "DONE",
          fase: "concluida",
          analisados: resultado.analisados,
          novos: resultado.novos,
          mensagem: resultado.mensagem,
          finishedAt: new Date(),
        },
      });
    } catch (err) {
      console.error(`Falha na busca do Agente Comercial (empresa ${companyId}):`, err);
      await prisma.captacaoRun
        .update({
          where: { id: run.id },
          data: {
            status: "ERROR",
            mensagem: `Não foi possível concluir a busca: ${descreverErro(err)}.`,
            finishedAt: new Date(),
          },
        })
        .catch(() => {});
    }
  });

  return { run, jaEmAndamento: false };
}
