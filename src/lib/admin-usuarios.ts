// Aba Usuários do /admin: situação comercial e resultado financeiro de cada conta. Cálculos puros (o banco é
// consultado nas rotas).

export const STATUS_ASSINATURA = ["EM_TESTE", "ATIVA", "PAGAMENTO_PENDENTE", "CANCELADA"] as const;
export type StatusAssinatura = (typeof STATUS_ASSINATURA)[number];

export const ROTULO_STATUS: Record<StatusAssinatura, string> = {
  EM_TESTE: "Em teste",
  ATIVA: "Ativo",
  PAGAMENTO_PENDENTE: "Pagamento pendente",
  CANCELADA: "Cancelado",
};

// Estimativa só para dar uma ideia em reais (o custo real vem em dólar, na fatura da Anthropic).
export const COTACAO_USD_BRL = 5.5;

export type EntradaFinanceira = {
  /** Preço mensal do plano da conta (null = sem plano). */
  precoPlano: number | null;
  /** Valor combinado com o cliente; quando existe, substitui o preço do plano. */
  valorPersonalizado: number | null;
  status: StatusAssinatura;
  /** Gasto de IA da conta no mês, em dólar. */
  custoUsd: number;
};

export type ResultadoFinanceiro = {
  valorMensal: number;
  /** O que de fato entra no mês: só conta ATIVA paga. Em teste, pendente e cancelada não somam receita. */
  receita: number;
  custoBrl: number;
  lucro: number;
};

const arredondar = (n: number) => Math.round(n * 100) / 100;

export function calcularFinanceiro(e: EntradaFinanceira): ResultadoFinanceiro {
  const valorMensal = e.valorPersonalizado ?? e.precoPlano ?? 0;
  const receita = e.status === "ATIVA" ? valorMensal : 0;
  const custoBrl = arredondar(e.custoUsd * COTACAO_USD_BRL);
  return { valorMensal: arredondar(valorMensal), receita: arredondar(receita), custoBrl, lucro: arredondar(receita - custoBrl) };
}

/** Primeiro instante do mês corrente no horário de Brasília (UTC-3, sem horário de verão). */
export function inicioDoMesBrasilia(agora: Date = new Date()): Date {
  const br = new Date(agora.getTime() - 3 * 3_600_000);
  return new Date(Date.UTC(br.getUTCFullYear(), br.getUTCMonth(), 1, 3, 0, 0));
}

export type LinhaParaTotal = { status: StatusAssinatura; valorMensal: number; receita: number; custoBrl: number; lucro: number };

export function somarTotais(linhas: LinhaParaTotal[]) {
  const soma = (f: (l: LinhaParaTotal) => number) => arredondar(linhas.reduce((a, l) => a + f(l), 0));
  return {
    contas: linhas.length,
    ativas: linhas.filter((l) => l.status === "ATIVA").length,
    emTeste: linhas.filter((l) => l.status === "EM_TESTE").length,
    pendentes: linhas.filter((l) => l.status === "PAGAMENTO_PENDENTE").length,
    canceladas: linhas.filter((l) => l.status === "CANCELADA").length,
    receitaMensal: soma((l) => l.receita),
    aReceber: soma((l) => (l.status === "PAGAMENTO_PENDENTE" ? l.valorMensal : 0)),
    custoBrl: soma((l) => l.custoBrl),
    lucro: soma((l) => l.lucro),
  };
}

/** Pode excluir esta conta? Nunca a própria nem a de outro administrador. */
export function motivoParaNaoExcluir(alvo: { id: string; email: string }, quemPede: { id: string; email: string }, emailsAdmin: string[]): string | null {
  if (alvo.id === quemPede.id) return "Você não pode excluir a sua própria conta.";
  if (emailsAdmin.includes(alvo.email.trim().toLowerCase())) return "Esta conta é de um administrador (ADMIN_EMAILS) e não pode ser excluída por aqui.";
  return null;
}

/** Confirmação digitada: o e-mail da conta, sem diferenciar maiúsculas nem espaços nas pontas. */
export function confirmacaoConfere(digitado: unknown, emailDaConta: string): boolean {
  return typeof digitado === "string" && digitado.trim().toLowerCase() === emailDaConta.trim().toLowerCase();
}
