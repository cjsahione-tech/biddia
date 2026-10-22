// Painel "Saúde das auditorias" (só administrador): o que aconteceu com as auditorias de habilitação num período.
// Funções puras — o banco é consultado na rota.

/** Meta: 99% das auditorias terminam sozinhas (com resultado correto ou com aviso claro do que falta). */
export const META_TERMINAR_SOZINHA = 0.99;
/** "Rodando" sem sinal de vida por mais que isto = travada. */
export const LIMITE_TRAVADA_AUDITORIA_MS = 10 * 60_000;

export type LinhaAuditoria = {
  estado: string; // RODANDO | CONCLUIDA | ERRO | NA_FILA | AGUARDANDO_SALDO | INTERROMPIDA
  statusEdital: string; // habilitacaoStatus do edital
  leituraCompleta: boolean;
  /** ERRO com nova tentativa agendada: ainda vai tentar sozinha. */
  retentativaAgendada: boolean;
  erroTipo: string | null;
  custoUsd: number;
  iniciadaEm: Date;
  concluidaEm: Date | null;
  updatedAt: Date;
};

export type TentativaLog = { resultado: string; tipoErro: string | null; metodo: string | null; duracaoMs: number | null; custoUsd: number };

export type SaudeAuditorias = {
  total: number;
  /** Leitura completa e resultado dado. */
  completas: number;
  /** Resultado dado, mas algum documento principal não foi lido por inteiro. */
  parciais: number;
  /** Resultado "bom" que o sistema não afirma: pede revisão manual. */
  revisarManualmente: number;
  /** Parou e só uma pessoa resolve (com mensagem e botões). */
  precisaAcao: number;
  /** Ainda rodando, na fila, esperando serviço ou com nova tentativa agendada. */
  emAndamento: number;
  /** Erro final sem explicação de ação: é o que a meta quer zerar. */
  erroFinal: number;
  /** Rodando há mais que o limite sem sinal de vida (o vigia deve resolver). */
  travadas: number;
  /** Terminaram sozinhas com resultado ou aviso claro, sobre as que já terminaram (ou travaram). null = nenhuma terminou. */
  taxaSozinha: number | null;
  tempo: { mediaMin: number | null; medianaMin: number | null };
  custo: { totalUsd: number; medioUsd: number | null; maximoUsd: number | null; acimaDoTeto: number };
  /** Erros mais comuns (das tentativas registradas). */
  errosComuns: { tipo: string; n: number }[];
  tentativas: { total: number; porResultado: { resultado: string; n: number }[]; porMetodo: { metodo: string; n: number }[] };
};

const mediana = (v: number[]) => {
  if (v.length === 0) return null;
  const o = [...v].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
};
const arredonda = (n: number, casas = 2) => Math.round(n * 10 ** casas) / 10 ** casas;

function contar<T>(itens: T[], chave: (t: T) => string | null): { chave: string; n: number }[] {
  const m = new Map<string, number>();
  for (const i of itens) {
    const k = chave(i);
    if (k) m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].map(([chave, n]) => ({ chave, n })).sort((a, b) => b.n - a.n);
}

export function resumirSaudeAuditorias(
  linhas: LinhaAuditoria[],
  tentativas: TentativaLog[],
  opts: { agora?: Date; tetoCustoUsd: number }
): SaudeAuditorias {
  const agora = opts.agora ?? new Date();
  let completas = 0, parciais = 0, revisar = 0, acao = 0, andamento = 0, erro = 0, travadas = 0;

  for (const l of linhas) {
    const travada = l.estado === "RODANDO" && agora.getTime() - l.updatedAt.getTime() > LIMITE_TRAVADA_AUDITORIA_MS;
    if (travada) {
      travadas++;
      continue;
    }
    if (l.statusEdital === "PRECISA_ACAO_HUMANA") acao++;
    else if (l.estado === "CONCLUIDA") {
      if (l.statusEdital === "REVISAR_MANUALMENTE") revisar++;
      else if (l.leituraCompleta) completas++;
      else parciais++;
    } else if (l.estado === "ERRO" && !l.retentativaAgendada) erro++;
    else andamento++;
  }

  const terminadas = completas + parciais + revisar + acao + erro + travadas;
  const sozinhas = completas + parciais + revisar + acao;

  const duracoesMin = linhas
    .filter((l) => l.estado === "CONCLUIDA" && l.concluidaEm)
    .map((l) => (l.concluidaEm!.getTime() - l.iniciadaEm.getTime()) / 60_000)
    .filter((m) => m >= 0);
  const media = duracoesMin.length ? duracoesMin.reduce((a, b) => a + b, 0) / duracoesMin.length : null;

  const custos = linhas.map((l) => l.custoUsd).filter((c) => c > 0);

  return {
    total: linhas.length,
    completas,
    parciais,
    revisarManualmente: revisar,
    precisaAcao: acao,
    emAndamento: andamento,
    erroFinal: erro,
    travadas,
    taxaSozinha: terminadas > 0 ? sozinhas / terminadas : null,
    tempo: { mediaMin: media === null ? null : arredonda(media, 1), medianaMin: mediana(duracoesMin) === null ? null : arredonda(mediana(duracoesMin)!, 1) },
    custo: {
      totalUsd: arredonda(custos.reduce((a, b) => a + b, 0), 2),
      medioUsd: custos.length ? arredonda(custos.reduce((a, b) => a + b, 0) / custos.length, 3) : null,
      maximoUsd: custos.length ? arredonda(Math.max(...custos), 3) : null,
      acimaDoTeto: custos.filter((c) => c > opts.tetoCustoUsd).length,
    },
    errosComuns: contar(tentativas, (t) => t.tipoErro).slice(0, 6).map((e) => ({ tipo: e.chave, n: e.n })),
    tentativas: {
      total: tentativas.length,
      porResultado: contar(tentativas, (t) => t.resultado).map((e) => ({ resultado: e.chave, n: e.n })),
      porMetodo: contar(tentativas, (t) => t.metodo).map((e) => ({ metodo: e.chave, n: e.n })),
    },
  };
}
