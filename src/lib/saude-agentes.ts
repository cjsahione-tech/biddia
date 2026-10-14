// Painel de saúde dos agentes (só administrador): taxa de erro e consumo de IA por agente. Funções puras — o
// banco é consultado na rota. A meta de 5% é sobre execuções que TERMINARAM; as em andamento não contam.
export const META_TAXA_ERRO = 0.05;

// Uma execução "rodando" há mais que isso morreu no meio (função cortada) e conta como falha.
export const LIMITE_TRAVADA_MS = 10 * 60_000;

export type ContagemExecucao = { agentKey: string; status: "RUNNING" | "DONE" | "ERROR"; iniciadaEm: Date };

export type SaudeDoAgente = { agentKey: string; execucoes: number; concluidas: number; falhas: number; taxaErro: number | null };

export function taxaDeErro(falhas: number, total: number): number | null {
  return total > 0 ? falhas / total : null;
}

export function resumirExecucoes(execucoes: ContagemExecucao[], agora: Date = new Date()): { porAgente: SaudeDoAgente[]; geral: SaudeDoAgente } {
  const mapa = new Map<string, { concluidas: number; falhas: number }>();
  for (const e of execucoes) {
    const travada = e.status === "RUNNING" && agora.getTime() - e.iniciadaEm.getTime() > LIMITE_TRAVADA_MS;
    if (e.status === "RUNNING" && !travada) continue; // ainda em andamento: não é resultado
    const atual = mapa.get(e.agentKey) ?? { concluidas: 0, falhas: 0 };
    if (e.status === "DONE") atual.concluidas++;
    else atual.falhas++;
    mapa.set(e.agentKey, atual);
  }
  const linha = (agentKey: string, c: { concluidas: number; falhas: number }): SaudeDoAgente => ({
    agentKey,
    execucoes: c.concluidas + c.falhas,
    concluidas: c.concluidas,
    falhas: c.falhas,
    taxaErro: taxaDeErro(c.falhas, c.concluidas + c.falhas),
  });
  const porAgente = [...mapa.entries()].map(([k, v]) => linha(k, v)).sort((a, b) => a.agentKey.localeCompare(b.agentKey));
  const total = porAgente.reduce((acc, a) => ({ concluidas: acc.concluidas + a.concluidas, falhas: acc.falhas + a.falhas }), { concluidas: 0, falhas: 0 });
  return { porAgente, geral: linha("geral", total) };
}

/**
 * Auditoria de habilitação: só ERRO e INTERROMPIDA são falhas. Fila, espera por saldo e retomadas
 * automáticas ainda não terminaram e não entram na conta.
 */
export function resumirAuditorias(estados: { estado: string; n: number }[]): SaudeDoAgente {
  const n = (...nomes: string[]) => estados.filter((e) => nomes.includes(e.estado)).reduce((a, e) => a + e.n, 0);
  const concluidas = n("CONCLUIDA");
  const falhas = n("ERRO", "INTERROMPIDA");
  return { agentKey: "auditoria-habilitacao", execucoes: concluidas + falhas, concluidas, falhas, taxaErro: taxaDeErro(falhas, concluidas + falhas) };
}
