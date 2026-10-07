// Cobrança mensal dos clientes da carteira de um Analista de Licitação.
//
// Cada cliente tem um "Plano mensal" (plano do público "Empresas do analista de licitação",
// criado no Admin) e o valor desse plano é cobrado mensalmente DIRETAMENTE DO CLIENTE — não
// do analista. O analista não define valor nenhum: o campo antigo "tarifa mensal cobrada
// deste cliente" foi removido e nada aqui o usa.
//
// Regra para cliente que entra ou sai no meio do mês: PROPORCIONAL AOS DIAS. O cliente paga
// só pelos dias em que esteve ativo naquele mês (o dia em que entrou e o dia em que foi
// desativado contam como ativos). Exemplo: plano de R$ 30, mês de 30 dias, cliente ativo por
// 10 dias => R$ 10,00. Os intervalos de cada cliente ficam guardados em
// PeriodoCobrancaCliente para auditar o cálculo. O valor usado é o do plano que o cliente
// tem hoje (uma troca de plano no meio do mês vale para o mês inteiro).
//
// Este arquivo só CALCULA — ainda não existe cobrança automática (gateway de pagamento,
// assinatura recorrente ou emissão de fatura) no sistema.

export type PeriodoCobranca = { inicio: Date; fim: Date | null };

/** valorMensal = preço do plano do cliente (0 se ele ainda não tem plano). */
export type ClienteComPeriodos = { id: string; valorMensal: number; periodos: PeriodoCobranca[] };

export type LinhaCobranca = { clienteId: string; diasAtivos: number; valor: number };

export type CobrancaMes = {
  ano: number;
  mes: number; // 1-12
  diasNoMes: number;
  linhas: LinhaCobranca[];
  total: number;
};

const FUSO = "America/Sao_Paulo";

/** Dia de calendário (AAAA-MM-DD) de um instante, no horário de Brasília — é como o cliente
 * enxerga "o dia em que entrei". Compara como texto, que ordena igual à data. */
function chaveDia(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: FUSO });
}

function chaveDiaDoMes(ano: number, mes: number, dia: number): string {
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

export function diasNoMes(ano: number, mes: number): number {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

/** Quantos dias do mês estão cobertos por pelo menos um dos períodos (sem contar duas vezes
 * um dia que caia em dois períodos). */
export function diasAtivosNoMes(periodos: PeriodoCobranca[], ano: number, mes: number): number {
  const total = diasNoMes(ano, mes);
  const faixas = periodos.map((p) => ({ inicio: chaveDia(p.inicio), fim: p.fim ? chaveDia(p.fim) : null }));
  let ativos = 0;
  for (let dia = 1; dia <= total; dia++) {
    const k = chaveDiaDoMes(ano, mes, dia);
    if (faixas.some((f) => f.inicio <= k && (f.fim === null || k <= f.fim))) ativos++;
  }
  return ativos;
}

const centavos = (v: number) => Math.round(v * 100) / 100;

export function calcularCobrancaMes(
  clientes: ClienteComPeriodos[],
  ano: number,
  mes: number
): CobrancaMes {
  const total = diasNoMes(ano, mes);
  const linhas = clientes
    .map((c) => {
      const diasAtivos = diasAtivosNoMes(c.periodos, ano, mes);
      return { clienteId: c.id, diasAtivos, valor: centavos((c.valorMensal * diasAtivos) / total) };
    })
    .filter((l) => l.diasAtivos > 0);

  return {
    ano,
    mes,
    diasNoMes: total,
    linhas,
    total: centavos(linhas.reduce((acc, l) => acc + l.valor, 0)),
  };
}

/** Mês corrente no horário de Brasília. */
export function mesAtual(agora = new Date()): { ano: number; mes: number } {
  const [ano, mes] = chaveDia(agora).split("-").map(Number);
  return { ano, mes };
}

/** Resumo para a tela: valor mensal cheio de hoje (soma dos planos dos clientes ativos) e a fatura prevista
 * do mês corrente (já descontando quem entrou ou saiu no meio do mês). */
export function resumoCobranca(clientes: ClienteComPeriodos[], agora = new Date()) {
  const { ano, mes } = mesAtual(agora);
  // "Ativo agora" = tem um período de cobrança ainda aberto (o dia da saída ainda conta na
  // fatura do mês, mas o cliente já não é mais ativo).
  const ativosHoje = clientes.filter((c) => c.periodos.some((p) => p.fim === null));
  const mesCorrente = calcularCobrancaMes(clientes, ano, mes);
  return {
    clientesAtivos: ativosHoje.length,
    totalMensalCheio: centavos(ativosHoje.reduce((acc, c) => acc + c.valorMensal, 0)),
    faturaPrevistaDoMes: mesCorrente.total,
    mesCorrente,
  };
}
