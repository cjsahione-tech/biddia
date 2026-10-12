import type { TipoErroIA } from "@/lib/ia-erros";

// Parâmetros e regras da auditoria de habilitação num só lugar (fáceis de ajustar).

/** Quantas auditorias podem rodar ao mesmo tempo (a chave da IA é uma só; muitas juntas → limite de uso). */
export const LIMITE_AUDITORIAS_SIMULTANEAS = 3;

/** Uma auditoria "rodando" que gravou sinal de vida há menos que isto conta como viva. */
export const BATIMENTO_VIVO_MS = 3 * 60_000;
/** "Rodando" sem sinal de vida por mais que isto = travada (função cortada): o vigia interrompe e re-enfileira. */
export const TEMPO_PARADA_MS = 10 * 60_000;

/** Quantas execuções encadeadas uma auditoria faz (limite de 4 saltos entre funções da Vercel); depois, a fila continua. */
export const MAX_CONTINUACOES_NA_CADEIA = 3;
/** Teto de passos de leitura de um edital gigante; passado isso, fecha com o que leu (nunca recusa). */
export const MAX_PASSOS_LEITURA = 10;
/** Passos seguidos sem avanço nenhum antes de desistir da rodada (evita laço infinito). */
export const MAX_PASSOS_SEM_AVANCO = 2;

/** Tentativas automáticas extras (além da primeira) e a espera antes de cada uma — cresce a cada falha. */
export const MAX_TENTATIVAS_AUTOMATICAS = 2;
export const ESPERAS_RETENTATIVA_MS = [2 * 60_000, 6 * 60_000];

/** Erros passageiros: valem uma nova tentativa automática (com espera crescente). */
const TIPOS_QUE_TENTAM_DE_NOVO = new Set<TipoErroIA>([
  "LIMITE_TAXA",
  "SOBRECARGA",
  "SERVICO_IA",
  "CONEXAO",
  "TEMPO_ESGOTADO",
  "RESPOSTA_INVALIDA",
  "ARQUIVO_ILEGIVEL", // quase sempre o portal do órgão que não respondeu ao baixar
]);

export type DecisaoAposFalha =
  | { acao: "aguardar_ia" } // saldo/chave: guarda e retoma sozinho (o disjuntor cuida; não conta tentativa)
  | { acao: "tentar_de_novo"; esperaMs: number }
  | { acao: "definitivo" }; // erro final: o usuário vê o motivo e "Tentar novamente"

export function decidirAposFalha(tipo: TipoErroIA, tentativasAutomaticas: number): DecisaoAposFalha {
  if (tipo === "SALDO_INSUFICIENTE" || tipo === "CHAVE_INVALIDA") return { acao: "aguardar_ia" };
  if (TIPOS_QUE_TENTAM_DE_NOVO.has(tipo) && tentativasAutomaticas < MAX_TENTATIVAS_AUTOMATICAS) {
    return { acao: "tentar_de_novo", esperaMs: ESPERAS_RETENTATIVA_MS[Math.min(tentativasAutomaticas, ESPERAS_RETENTATIVA_MS.length - 1)] };
  }
  return { acao: "definitivo" };
}
