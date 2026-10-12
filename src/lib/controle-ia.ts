import { prisma } from "@/lib/prisma";
import { classificarErro, ErroTipado, mensagemAmigavelDoTipo, type TipoErroIA } from "@/lib/ia-erros";

// "Disjuntor" da IA. Quando a API responde que o saldo acabou (ou que a chave foi recusada),
// continuar chamando só gera uma enxurrada de erros e gasta tentativas das auditorias. Então:
//   1. a primeira falha desse tipo ABRE o disjuntor (pausa as chamadas por PAUSA_MS);
//   2. enquanto aberto, qualquer chamada falha na hora, sem ir até a API (as auditorias ficam
//      guardadas em "aguardando saldo");
//   3. passado o prazo, UMA chamada mínima de teste decide: se passar, o disjuntor fecha e
//      tudo retoma sozinho; se falhar de novo, a pausa se renova.
// O estado fica no banco (tabela ControleIA, linha "global") porque cada requisição roda numa
// função serverless diferente — memória não é compartilhada entre elas.

export const PAUSA_MS = 10 * 60_000;
// Enquanto uma função testa a conexão, as outras não repetem o teste por este tempo.
const JANELA_DO_TESTE_MS = 2 * 60_000;
// Cache curto do estado "livre" para não consultar o banco a cada chamada de IA.
const CACHE_LIVRE_MS = 15_000;

const ID = "global";
let livreAte = 0;

export type EstadoIA = {
  pausada: boolean;
  motivo: TipoErroIA | null;
  desde: Date | null;
  pausadaAte: Date | null;
};

export async function lerEstadoIA(): Promise<EstadoIA> {
  const c = await prisma.controleIA.findUnique({ where: { id: ID } });
  const pausada = !!c?.pausadaAte;
  return {
    pausada,
    motivo: pausada ? ((c?.motivo as TipoErroIA | null) ?? "SALDO_INSUFICIENTE") : null,
    desde: c?.saldoEsgotadoDesde ?? null,
    pausadaAte: c?.pausadaAte ?? null,
  };
}

/** Abre (ou renova) a pausa quando o erro é de saldo/chave. Qualquer outro tipo é ignorado. */
export async function registrarFalhaIA(err: unknown): Promise<void> {
  const c = classificarErro(err);
  if (!c.pausaIA) return;
  const agora = new Date();
  const ate = new Date(agora.getTime() + PAUSA_MS);
  livreAte = 0;
  await prisma.controleIA
    .upsert({
      where: { id: ID },
      create: { id: ID, saldoEsgotadoDesde: agora, motivo: c.tipo, pausadaAte: ate },
      update: { motivo: c.tipo, pausadaAte: ate },
    })
    .catch((e) => console.error("Falha ao registrar pausa da IA:", e));
  // Se já havia uma pausa, mantém o "desde" original.
  await prisma.controleIA.updateMany({ where: { id: ID, saldoEsgotadoDesde: null }, data: { saldoEsgotadoDesde: agora } }).catch(() => null);
}

async function fecharDisjuntor() {
  await prisma.controleIA
    .update({ where: { id: ID }, data: { saldoEsgotadoDesde: null, pausadaAte: null, motivo: null, avisadoAdminEm: null } })
    .catch(() => null);
  livreAte = Date.now() + CACHE_LIVRE_MS;
}

/**
 * Chame antes de qualquer chamada à IA. Retorna se está liberado; se o disjuntor estiver
 * aberto, lança ErroTipado (saldo/chave) SEM tocar na API. `testar` é a chamada mínima
 * (1 token) usada só quando a pausa venceu.
 */
export async function garantirIALiberada(testar: () => Promise<void>): Promise<void> {
  const agora = Date.now();
  if (agora < livreAte) return;

  const c = await prisma.controleIA.findUnique({ where: { id: ID } });
  if (!c?.pausadaAte) {
    livreAte = agora + CACHE_LIVRE_MS;
    return;
  }

  const tipo = ((c.motivo as TipoErroIA | null) ?? "SALDO_INSUFICIENTE") as TipoErroIA;
  if (agora < c.pausadaAte.getTime()) throw new ErroTipado(tipo, mensagemAmigavelDoTipo(tipo));

  // Pausa vencida: só uma função faz o teste (a que conseguir "reservar" a janela).
  const reserva = await prisma.controleIA.updateMany({
    where: { id: ID, pausadaAte: c.pausadaAte },
    data: { pausadaAte: new Date(agora + JANELA_DO_TESTE_MS), ultimoTesteEm: new Date(agora) },
  });
  if (reserva.count === 0) throw new ErroTipado(tipo, mensagemAmigavelDoTipo(tipo));

  try {
    await testar();
    await fecharDisjuntor();
  } catch (err) {
    const novo = classificarErro(err);
    if (novo.pausaIA) {
      await prisma.controleIA
        .update({ where: { id: ID }, data: { pausadaAte: new Date(Date.now() + PAUSA_MS), motivo: novo.tipo } })
        .catch(() => null);
      throw new ErroTipado(novo.tipo, mensagemAmigavelDoTipo(novo.tipo));
    }
    // Outro tipo de falha no teste (sobrecarga, limite...): a conta tem saldo, a IA só está
    // instável — libera e deixa o tratamento normal (retry) cuidar.
    await fecharDisjuntor();
  }
}
