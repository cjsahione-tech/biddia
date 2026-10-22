// O Storage do Supabase pode ficar BLOQUEADO (ex.: cota de tráfego estourada — "exceed_egress_quota"). Nesse caso toda leitura
// e gravação de arquivo falha. Aqui ficam o erro com nome próprio e um "disjuntor" de memória: depois da primeira falha de
// bloqueio, as próximas chamadas nem tentam por alguns minutos (não adianta e só gasta tempo e rede).

export class ArmazenamentoIndisponivelError extends Error {
  constructor(mensagem = "O armazenamento de arquivos está temporariamente indisponível.") {
    super(mensagem);
    this.name = "ArmazenamentoIndisponivelError";
  }
}

/** A resposta do Supabase Storage indica bloqueio/restrição do projeto (e não um erro comum de um arquivo)? */
export function ehRestricaoDeArmazenamento(mensagem: string, status?: number | string | null): boolean {
  const m = mensagem.toLowerCase();
  if (/exceed_egress_quota|exceed_storage_quota|exceed_.*quota/.test(m)) return true;
  if (/service for this project is restricted|project is restricted|restricted due to/.test(m)) return true;
  // 402 (Payment Required) é o código usado quando o projeto está com a cobrança/cota bloqueada.
  return String(status ?? "") === "402";
}

export function ehErroDeArmazenamentoIndisponivel(err: unknown): boolean {
  if (err instanceof ArmazenamentoIndisponivelError) return true;
  return err instanceof Error && err.name === "ArmazenamentoIndisponivelError";
}

// ── Disjuntor em memória ────────────────────────────────────────────────────
// Por instância da função (não é compartilhado entre servidores): serve para não martelar o Storage durante um bloqueio.
const PAUSA_APOS_BLOQUEIO_MS = 3 * 60_000;
let bloqueadoAte = 0;

export function marcarArmazenamentoBloqueado(agora: number = Date.now()) {
  bloqueadoAte = agora + PAUSA_APOS_BLOQUEIO_MS;
}

export function marcarArmazenamentoLiberado() {
  bloqueadoAte = 0;
}

/** true = pode tentar usar o Storage; false = está em pausa por bloqueio recente. */
export function armazenamentoLiberado(agora: number = Date.now()): boolean {
  return agora >= bloqueadoAte;
}

/** Lança o erro tipado se o disjuntor estiver aberto (para quem vai começar um trabalho que depende do Storage). */
export function exigirArmazenamentoLiberado(agora: number = Date.now()) {
  if (!armazenamentoLiberado(agora)) throw new ArmazenamentoIndisponivelError();
}
