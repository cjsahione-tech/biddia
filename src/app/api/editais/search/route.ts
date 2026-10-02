import { NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCompany } from "@/lib/api-utils";
import { executarAgente1 } from "@/lib/agents/agente1-comercial";
import { descreverErro } from "@/lib/ia-erros";

// A busca varre PNCP/LicitaNet/Compras.gov.br, classifica com IA e cria os cards — pode
// levar quase o teto de 60s da Vercel. Por isso roda em SEGUNDO PLANO: o POST responde na
// hora com o id da execução e a tela acompanha o progresso por GET (os cards aparecem no
// quadro à medida que são criados), em vez de ficar presa numa requisição longa que
// podia estourar o tempo e dar erro mesmo com parte dos editais já criada.
export const maxDuration = 60;

// Execução "RUNNING" há mais que isso morreu junto com a função serverless (60s) — não
// bloqueia uma nova busca nem fica pra sempre como "buscando" na tela.
const LIMITE_EXECUCAO_MS = 75_000;

async function encerrarOrfas(companyId: string) {
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

/** Última busca da empresa (ou a que está em andamento) — usado pela tela pra acompanhar. */
export async function GET() {
  const { company, error } = await requireCompany();
  if (error) return error;

  await encerrarOrfas(company!.id);
  const run = await prisma.captacaoRun.findFirst({
    where: { companyId: company!.id },
    orderBy: { startedAt: "desc" },
  });
  return NextResponse.json({ run });
}

/** Dispara o Agente Comercial em segundo plano. */
export async function POST() {
  const { company, error } = await requireCompany();
  if (error) return error;
  const companyId = company!.id;

  await encerrarOrfas(companyId);
  const emAndamento = await prisma.captacaoRun.findFirst({ where: { companyId, status: "RUNNING" } });
  if (emAndamento) return NextResponse.json({ run: emAndamento, jaEmAndamento: true }, { status: 202 });

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

  return NextResponse.json({ run }, { status: 202 });
}
