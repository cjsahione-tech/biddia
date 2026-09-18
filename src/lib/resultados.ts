import { prisma } from "@/lib/prisma";
import { ETAPAS_KANBAN, ETAPAS_NEGATIVAS, ETAPAS_GANHAS } from "@/lib/kanban";
import { labelPortal } from "@/lib/fonte-edital";
import type { EtapaKanban } from "@/lib/types";

// Formato mínimo de edital que o Dashboard de Resultados precisa — deliberadamente
// menor que EditalListItem (evita acoplar essa tela ao shape do Kanban, que carrega
// campos que aqui não interessam).
export type EditalParaResultados = {
  id: string;
  titulo: string;
  fonte: string;
  uf: string | null;
  orgaoNome: string;
  tipoObjeto: "SERVICO" | "BEM" | "AMBOS" | null;
  etapaKanban: EtapaKanban;
  valorGlobal: number | null;
  orcamentoSigiloso: boolean;
  createdAt: string; // ISO
  decidedAt: string | null;
  proposalValor: number | null;
};

export type SituacaoFiltro = "TODOS" | "ANDAMENTO" | "GANHOS" | "PERDIDOS";

export type FiltrosResultados = {
  de: string | null; // "yyyy-mm-dd", inclusive
  ate: string | null; // "yyyy-mm-dd", inclusive
  situacao: SituacaoFiltro;
  fonte: string | null;
  uf: string | null;
  tipoObjeto: string | null; // "SERVICO" | "BEM" | "AMBOS" | "NAO_CLASSIFICADO"
};

export const FILTROS_PADRAO: FiltrosResultados = {
  de: null,
  ate: null,
  situacao: "TODOS",
  fonte: null,
  uf: null,
  tipoObjeto: null,
};

const SITUACOES_VALIDAS = new Set<SituacaoFiltro>(["TODOS", "ANDAMENTO", "GANHOS", "PERDIDOS"]);

/** Lê os filtros a partir da query string da requisição — reaproveitado pela rota JSON e pela de exportação em PDF, para os dois nunca divergirem sobre o que cada filtro significa. */
export function filtrosDaQueryString(searchParams: URLSearchParams): FiltrosResultados {
  const situacaoBruta = searchParams.get("situacao");
  const situacao = SITUACOES_VALIDAS.has(situacaoBruta as SituacaoFiltro)
    ? (situacaoBruta as SituacaoFiltro)
    : FILTROS_PADRAO.situacao;

  return {
    de: searchParams.get("de") || null,
    ate: searchParams.get("ate") || null,
    situacao,
    fonte: searchParams.get("fonte") || null,
    uf: searchParams.get("uf") || null,
    tipoObjeto: searchParams.get("tipoObjeto") || null,
  };
}

/** Inverso de filtrosDaQueryString — usado pelo front pra montar a URL de fetch e o link de exportação em PDF sem duplicar a lista de parâmetros em dois lugares. */
export function filtrosParaQueryString(filtros: FiltrosResultados): string {
  const params = new URLSearchParams();
  if (filtros.de) params.set("de", filtros.de);
  if (filtros.ate) params.set("ate", filtros.ate);
  if (filtros.situacao !== FILTROS_PADRAO.situacao) params.set("situacao", filtros.situacao);
  if (filtros.fonte) params.set("fonte", filtros.fonte);
  if (filtros.uf) params.set("uf", filtros.uf);
  if (filtros.tipoObjeto) params.set("tipoObjeto", filtros.tipoObjeto);
  return params.toString();
}

export const TIPO_OBJETO_LABEL: Record<string, string> = {
  SERVICO: "Serviço",
  BEM: "Bem",
  AMBOS: "Bem e Serviço",
  NAO_CLASSIFICADO: "Não classificado",
};

export function situacaoDoEdital(e: Pick<EditalParaResultados, "etapaKanban">): "ANDAMENTO" | "GANHOS" | "PERDIDOS" {
  if (ETAPAS_GANHAS.has(e.etapaKanban)) return "GANHOS";
  if (ETAPAS_NEGATIVAS.has(e.etapaKanban)) return "PERDIDOS";
  return "ANDAMENTO";
}

// Valor de referência do edital para fins de soma: o valor publicado (quando não
// sigiloso) ou, na falta dele, o valor que a própria proposta acabou montando — nunca os
// dois somados. `orcamentoSigiloso` já implica `valorGlobal: null` na origem (ver
// agente1-comercial.ts), então não precisa de um branch específico aqui.
function valorDoEdital(e: EditalParaResultados): number | null {
  return e.valorGlobal ?? e.proposalValor ?? null;
}

export function aplicarFiltros(editais: EditalParaResultados[], filtros: FiltrosResultados): EditalParaResultados[] {
  const de = filtros.de ? new Date(`${filtros.de}T00:00:00`).getTime() : null;
  const ate = filtros.ate ? new Date(`${filtros.ate}T23:59:59.999`).getTime() : null;

  return editais.filter((e) => {
    const criadoEm = new Date(e.createdAt).getTime();
    if (de !== null && criadoEm < de) return false;
    if (ate !== null && criadoEm > ate) return false;
    if (filtros.situacao !== "TODOS" && situacaoDoEdital(e) !== filtros.situacao) return false;
    if (filtros.fonte && e.fonte !== filtros.fonte) return false;
    if (filtros.uf && e.uf !== filtros.uf) return false;
    if (filtros.tipoObjeto && (e.tipoObjeto ?? "NAO_CLASSIFICADO") !== filtros.tipoObjeto) return false;
    return true;
  });
}

export type ContagemComValor = { chave: string; label: string; quantidade: number; valor: number };

function agruparComValor(
  editais: EditalParaResultados[],
  chaveDe: (e: EditalParaResultados) => string,
  labelDe: (chave: string) => string,
  opts?: { top?: number }
): ContagemComValor[] {
  const mapa = new Map<string, { quantidade: number; valor: number }>();
  for (const e of editais) {
    const chave = chaveDe(e);
    const atual = mapa.get(chave) ?? { quantidade: 0, valor: 0 };
    atual.quantidade += 1;
    atual.valor += valorDoEdital(e) ?? 0;
    mapa.set(chave, atual);
  }

  let itens = Array.from(mapa.entries())
    .map(([chave, v]) => ({ chave, label: labelDe(chave), quantidade: v.quantidade, valor: v.valor }))
    .sort((a, b) => b.quantidade - a.quantidade);

  const top = opts?.top;
  if (top && itens.length > top) {
    const principais = itens.slice(0, top);
    const somaOutros = itens.slice(top).reduce(
      (acc, i) => ({ quantidade: acc.quantidade + i.quantidade, valor: acc.valor + i.valor }),
      { quantidade: 0, valor: 0 }
    );
    itens = [...principais, { chave: "OUTROS", label: "Outros", ...somaOutros }];
  }
  return itens;
}

export type PontoEvolucaoMensal = { mes: string; label: string; captados: number; ganhos: number; perdidos: number };

// Teto de meses no gráfico de evolução — mantém só os mais recentes se o histórico da
// empresa passar disso, pra não deixar o gráfico ilegível de tão comprimido.
const MAX_MESES_EVOLUCAO = 18;

function chaveMes(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function labelMes(chave: string): string {
  const [ano, mes] = chave.split("-").map(Number);
  const d = new Date(ano, mes - 1, 1);
  return new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit" }).format(d).replace(".", "");
}

function montarEvolucaoMensal(editais: EditalParaResultados[]): PontoEvolucaoMensal[] {
  if (editais.length === 0) return [];

  const datas = editais.map((e) => new Date(e.createdAt).getTime());
  const minima = new Date(Math.min(...datas));
  const maxima = new Date(Math.max(...datas));

  let chaves: string[] = [];
  const cursor = new Date(minima.getFullYear(), minima.getMonth(), 1);
  const fim = new Date(maxima.getFullYear(), maxima.getMonth(), 1);
  while (cursor <= fim) {
    chaves.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  if (chaves.length > MAX_MESES_EVOLUCAO) chaves = chaves.slice(-MAX_MESES_EVOLUCAO);

  const porMes = new Map<string, { captados: number; ganhos: number; perdidos: number }>();
  for (const chave of chaves) porMes.set(chave, { captados: 0, ganhos: 0, perdidos: 0 });

  for (const e of editais) {
    const bucket = porMes.get(chaveMes(e.createdAt));
    if (!bucket) continue; // fora do teto de meses mantidos (histórico bem antigo)
    bucket.captados += 1;
    const sit = situacaoDoEdital(e);
    if (sit === "GANHOS") bucket.ganhos += 1;
    else if (sit === "PERDIDOS") bucket.perdidos += 1;
  }

  return chaves.map((chave) => ({ mes: chave, label: labelMes(chave), ...porMes.get(chave)! }));
}

export type ResultadosAgregados = {
  totalFiltrado: number;
  totalGeral: number;
  ganhos: number;
  perdidos: number;
  emAndamento: number;
  taxaConversao: number | null; // 0–1, entre ganhos e (ganhos + perdidos)
  valorGanho: number;
  qtdGanhosComValor: number;
  ticketMedioGanho: number | null;
  valorEmDisputa: number;
  qtdEmDisputaComValor: number;
  valorPerdido: number;
  qtdSigilosos: number;
  tempoMedioDecisaoDias: number | null;
  funil: { etapa: EtapaKanban; label: string; quantidade: number }[];
  porPortal: ContagemComValor[];
  porUf: ContagemComValor[];
  porTipoObjeto: ContagemComValor[];
  porOrgao: ContagemComValor[];
  evolucaoMensal: PontoEvolucaoMensal[];
  opcoesFiltro: { ufs: string[]; fontes: string[] };
};

/**
 * Busca todos os editais de uma empresa (sem filtro nenhum) já no formato reduzido que
 * o Dashboard de Resultados precisa — reaproveitado pela rota JSON e pela de exportação
 * em PDF, pra nunca haver dois shapes de query divergindo entre elas.
 */
export async function buscarEditaisParaResultados(companyId: string): Promise<EditalParaResultados[]> {
  const editais = await prisma.edital.findMany({
    where: { companyId },
    select: {
      id: true,
      titulo: true,
      fonte: true,
      uf: true,
      orgaoNome: true,
      tipoObjeto: true,
      etapaKanban: true,
      valorGlobal: true,
      orcamentoSigiloso: true,
      createdAt: true,
      decidedAt: true,
      proposal: { select: { valorGlobalReferencia: true } },
    },
  });

  return editais.map((e) => ({
    id: e.id,
    titulo: e.titulo,
    fonte: e.fonte,
    uf: e.uf,
    orgaoNome: e.orgaoNome,
    tipoObjeto: e.tipoObjeto as EditalParaResultados["tipoObjeto"],
    etapaKanban: e.etapaKanban,
    valorGlobal: e.valorGlobal,
    orcamentoSigiloso: e.orcamentoSigiloso,
    createdAt: e.createdAt.toISOString(),
    decidedAt: e.decidedAt ? e.decidedAt.toISOString() : null,
    proposalValor: e.proposal?.valorGlobalReferencia ?? null,
  }));
}

/**
 * Ponto único de cálculo do Dashboard de Resultados: recebe TODOS os editais da empresa
 * (sem filtro) e os filtros escolhidos na tela, e devolve tudo que a UI (e o export em
 * PDF) precisam — filtrar aqui em vez de no Prisma mantém a lógica testável sem banco e
 * reaproveitável entre a rota JSON e a rota de PDF.
 */
export function montarResultados(todos: EditalParaResultados[], filtros: FiltrosResultados): ResultadosAgregados {
  const filtrados = aplicarFiltros(todos, filtros);

  const ganhos = filtrados.filter((e) => situacaoDoEdital(e) === "GANHOS");
  const perdidos = filtrados.filter((e) => situacaoDoEdital(e) === "PERDIDOS");
  const emAndamento = filtrados.filter((e) => situacaoDoEdital(e) === "ANDAMENTO");

  const decididos = ganhos.length + perdidos.length;
  const taxaConversao = decididos > 0 ? ganhos.length / decididos : null;

  const valoresGanhos = ganhos.map(valorDoEdital).filter((v): v is number => v != null && v > 0);
  const valorGanho = valoresGanhos.reduce((a, b) => a + b, 0);
  const ticketMedioGanho = valoresGanhos.length > 0 ? valorGanho / valoresGanhos.length : null;

  const valoresEmDisputa = emAndamento.map(valorDoEdital).filter((v): v is number => v != null && v > 0);
  const valorEmDisputa = valoresEmDisputa.reduce((a, b) => a + b, 0);

  const valoresPerdidos = perdidos.map(valorDoEdital).filter((v): v is number => v != null && v > 0);
  const valorPerdido = valoresPerdidos.reduce((a, b) => a + b, 0);

  const decisoesComTempo = filtrados.filter((e) => e.decidedAt);
  const tempoMedioDecisaoDias =
    decisoesComTempo.length > 0
      ? decisoesComTempo.reduce(
          (acc, e) => acc + (new Date(e.decidedAt!).getTime() - new Date(e.createdAt).getTime()) / 86_400_000,
          0
        ) / decisoesComTempo.length
      : null;

  const funil = ETAPAS_KANBAN.map((et) => ({
    etapa: et.key,
    label: et.label,
    quantidade: filtrados.filter((e) => e.etapaKanban === et.key).length,
  }));

  const porPortal = agruparComValor(filtrados, (e) => e.fonte, (chave) => labelPortal(chave));
  const porUf = agruparComValor(
    filtrados,
    (e) => e.uf ?? "NAO_INFORMADO",
    (chave) => (chave === "NAO_INFORMADO" ? "Não informado" : chave),
    { top: 8 }
  );
  const porTipoObjeto = agruparComValor(
    filtrados,
    (e) => e.tipoObjeto ?? "NAO_CLASSIFICADO",
    (chave) => TIPO_OBJETO_LABEL[chave] ?? chave
  );
  const porOrgao = agruparComValor(filtrados, (e) => e.orgaoNome, (chave) => chave, { top: 6 });

  const opcoesFiltro = {
    ufs: Array.from(new Set(todos.map((e) => e.uf).filter((v): v is string => !!v))).sort(),
    fontes: Array.from(new Set(todos.map((e) => e.fonte))).sort(),
  };

  return {
    totalFiltrado: filtrados.length,
    totalGeral: todos.length,
    ganhos: ganhos.length,
    perdidos: perdidos.length,
    emAndamento: emAndamento.length,
    taxaConversao,
    valorGanho,
    qtdGanhosComValor: valoresGanhos.length,
    ticketMedioGanho,
    valorEmDisputa,
    qtdEmDisputaComValor: valoresEmDisputa.length,
    valorPerdido,
    qtdSigilosos: filtrados.filter((e) => e.orcamentoSigiloso).length,
    tempoMedioDecisaoDias,
    funil,
    porPortal,
    porUf,
    porTipoObjeto,
    porOrgao,
    evolucaoMensal: montarEvolucaoMensal(filtrados),
    opcoesFiltro,
  };
}
