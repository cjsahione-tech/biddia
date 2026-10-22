import type { HabilitacaoStatus } from "@prisma/client";
import { statusHabilitacaoDefinitivaDoErro } from "@/lib/habilitacao";
import type { TipoErroIA } from "@/lib/ia-erros";

// Selos "em andamento" que ficaram para trás: o edital diz "Auditando…" / "Na fila" / "Aguardando" mas a auditoria
// por trás não existe ou já terminou com erro. Nada pode ficar "processando" para sempre — o vigia corrige.

const SELOS_EM_ANDAMENTO: ReadonlySet<string> = new Set(["AUDITANDO", "NA_FILA", "AGUARDANDO_IA", "TEMPO_ESGOTADO"]);

export type CorrecaoDeSelo = { acao: "enfileirar" } | { acao: "definir"; status: HabilitacaoStatus } | null;

export function corrigirSeloPreso(opts: {
  statusEdital: string;
  auditoria: { estado: string; erroTipo: string | null; proximaTentativaEm: Date | null } | null;
}): CorrecaoDeSelo {
  if (!SELOS_EM_ANDAMENTO.has(opts.statusEdital)) return null;

  // Selo de andamento sem auditoria nenhuma por trás: coloca na fila de verdade.
  if (!opts.auditoria) return { acao: "enfileirar" };

  // Auditoria terminou em erro sem nova tentativa agendada: o selo tem de mostrar o erro final, não "tentando de novo".
  if (opts.auditoria.estado === "ERRO" && !opts.auditoria.proximaTentativaEm) {
    return { acao: "definir", status: statusHabilitacaoDefinitivaDoErro((opts.auditoria.erroTipo ?? "DESCONHECIDO") as TipoErroIA) };
  }
  return null;
}
