import type { CorCard, EtapaKanban } from "@/lib/types";

// Ordem e rótulos das colunas do quadro — espelha o quadro de referência do usuário.
export const ETAPAS_KANBAN: { key: EtapaKanban; label: string }[] = [
  { key: "OPORTUNIDADE", label: "Oportunidade" },
  { key: "QUALIFICACAO", label: "Qualificação" },
  { key: "SEM_PROPOSTAS", label: "Editais em preparação" },
  { key: "PRONTA_PARA_ENVIAR", label: "Pronta para Enviar" },
  { key: "ENVIADA_PARA_DISPUTA", label: "Enviada para Disputa" },
  { key: "CLASSIFICACAO", label: "Classificação" },
  { key: "ELIMINADA_APOS_CLASSIFICACAO", label: "Eliminada após Classificação" },
  { key: "ACEITA", label: "Aceita" },
  { key: "RECUSADA_DESCLASSIFICADA", label: "Recusada/Desclassificada" },
  { key: "EM_CONTRATO", label: "Em contrato" },
  { key: "FINALIZADA", label: "Finalizada" },
  { key: "RASCUNHO", label: "Rascunho" },
];

export const ETAPA_LABEL: Record<EtapaKanban, string> = Object.fromEntries(
  ETAPAS_KANBAN.map((e) => [e.key, e.label])
) as Record<EtapaKanban, string>;

// Colunas de desfecho negativo — equivalem ao antigo "Reprovar" quando um card sai de
// "Oportunidade" indo direto para uma delas.
export const ETAPAS_NEGATIVAS = new Set<EtapaKanban>([
  "SEM_PROPOSTAS",
  "ELIMINADA_APOS_CLASSIFICACAO",
  "RECUSADA_DESCLASSIFICADA",
]);

// Colunas de desfecho positivo — a licitação foi ganha (proposta aceita) ou já está em
// execução/concluída depois de ganha. Usado pelo Dashboard de Resultados para calcular
// taxa de conversão e valores ganhos.
export const ETAPAS_GANHAS = new Set<EtapaKanban>(["ACEITA", "EM_CONTRATO", "FINALIZADA"]);

// Etiquetas de cor do card, estilo Trello — classes já resolvidas para não precisar de
// template string dinâmica (o Tailwind não gera classe pra string montada em runtime).
export const CORES_CARD: { key: CorCard; label: string; dot: string; faixa: string }[] = [
  { key: "azul", label: "Azul", dot: "bg-blue-500", faixa: "border-l-blue-500" },
  { key: "verde", label: "Verde", dot: "bg-emerald-500", faixa: "border-l-emerald-500" },
  { key: "amarelo", label: "Amarelo", dot: "bg-amber-400", faixa: "border-l-amber-400" },
  { key: "laranja", label: "Laranja", dot: "bg-orange-500", faixa: "border-l-orange-500" },
  { key: "vermelho", label: "Vermelho", dot: "bg-red-500", faixa: "border-l-red-500" },
  { key: "roxo", label: "Roxo", dot: "bg-purple-500", faixa: "border-l-purple-500" },
  { key: "rosa", label: "Rosa", dot: "bg-pink-500", faixa: "border-l-pink-500" },
  { key: "cinza", label: "Cinza", dot: "bg-slate-400", faixa: "border-l-slate-400" },
];

export function faixaCorCard(cor: CorCard | null): string {
  return CORES_CARD.find((c) => c.key === cor)?.faixa ?? "border-l-transparent";
}

// Agrupamento da coluna "Oportunidade" por modalidade (ver KanbanBoard.tsx) — ordem fixa
// pedida pelo usuário, com "Outras modalidades" sempre por último pra nenhum card sumir
// por não bater com nenhum grupo.
export const GRUPOS_MODALIDADE = [
  "Concorrência - Eletrônica",
  "Concorrência - Presencial",
  "Credenciamento",
  "Dispensa",
  "Inexigibilidade",
  "Leilão - Eletrônico",
  "Leilão - Presencial",
  "Pré-qualificação",
  "Pregão - Eletrônico",
  "Pregão - Presencial",
] as const;

export const GRUPO_OUTRAS_MODALIDADES = "Outras modalidades";

// A modalidade vem como texto livre do PNCP/LicitaNet/extração de PDF (ex: "Pregão
// Eletrônico", "Concorrência - Eletrônica", "Dispensa de Licitação") — nunca bate 100%
// com a grafia fixa dos grupos acima, então classifica por palavra-chave normalizada
// (sem acento/maiúscula/hífen) em vez de comparação direta de string.
function normalizarTexto(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function classificarModalidade(modalidadeBruta: string | null): string {
  if (!modalidadeBruta) return GRUPO_OUTRAS_MODALIDADES;
  const m = normalizarTexto(modalidadeBruta);
  const presencial = m.includes("presencial");

  if (m.includes("concorrencia")) return presencial ? "Concorrência - Presencial" : "Concorrência - Eletrônica";
  if (m.includes("credenciamento")) return "Credenciamento";
  if (m.includes("dispensa")) return "Dispensa";
  if (m.includes("inexigibilidade")) return "Inexigibilidade";
  if (m.includes("leilao")) return presencial ? "Leilão - Presencial" : "Leilão - Eletrônico";
  if (m.includes("pre qualificacao")) return "Pré-qualificação";
  if (m.includes("pregao")) return presencial ? "Pregão - Presencial" : "Pregão - Eletrônico";

  return GRUPO_OUTRAS_MODALIDADES;
}

// Mesma paleta da tarja lateral do card, só que como preenchimento sólido — usada na
// faixa horizontal fina no topo do modal de detalhes do card.
export function topoCorCard(cor: CorCard | null): string {
  return CORES_CARD.find((c) => c.key === cor)?.dot ?? "bg-transparent";
}
