import { Loader2 } from "lucide-react";
import type { HabilitacaoStatusTipo } from "@/lib/types";
import { DICA_STATUS_HABILITACAO, etapaAudita, ROTULO_STATUS_HABILITACAO } from "@/lib/habilitacao";

// Selo colorido do resultado da auditoria de habilitação (cartão do Kanban e tela do edital).
const ESTILO: Record<HabilitacaoStatusTipo, string> = {
  AGUARDANDO: "bg-surface text-muted",
  AUDITANDO: "bg-brand-light text-brand",
  HABILITADA: "bg-accent/10 text-accent",
  HABILITADA_RESSALVAS: "bg-warning/10 text-warning",
  NAO_HABILITADA: "bg-danger/10 text-danger",
  ERRO: "bg-muted/10 text-muted",
  NA_FILA: "bg-surface text-muted",
  AGUARDANDO_IA: "bg-warning/10 text-warning",
  ARQUIVO_ILEGIVEL: "bg-danger/10 text-danger",
  EDITAL_GRANDE: "bg-warning/10 text-warning",
  TEMPO_ESGOTADO: "bg-warning/10 text-warning",
  REVISAR_MANUALMENTE: "bg-warning/10 text-warning",
};

const EM_ANDAMENTO = ["AUDITANDO", "AGUARDANDO_IA", "TEMPO_ESGOTADO", "EDITAL_GRANDE"];

const RESULTADOS = ["HABILITADA", "HABILITADA_RESSALVAS", "NAO_HABILITADA", "REVISAR_MANUALMENTE"];

export function SeloHabilitacao({
  status,
  percentual,
  tamanho = "pequeno",
  etapa,
}: {
  status: HabilitacaoStatusTipo;
  percentual?: number | null;
  tamanho?: "pequeno" | "normal";
  /** Etapa do card. Antes de Qualificação não há auditoria: nada de erro ou "Auditando…". */
  etapa?: string;
}) {
  const classes = tamanho === "pequeno" ? "px-1.5 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs";
  // Oportunidade (e Rascunho/etapas negativas): só mostra um resultado já pronto; qualquer
  // outro estado (erro, travado, sem auditoria) vira o aviso neutro de que será auditado ao qualificar.
  if (etapa && !etapaAudita(etapa) && !RESULTADOS.includes(status)) {
    if (etapa !== "OPORTUNIDADE") return null;
    return (
      <span
        className={`inline-flex items-center rounded-full bg-surface font-medium text-muted ${classes}`}
        title="A auditoria de habilitação é feita automaticamente quando o edital entra em Qualificação — assim a IA só é usada nos editais que você vai disputar."
      >
        Será auditado ao qualificar
      </span>
    );
  }
  const mostrarPercentual = percentual != null && ["HABILITADA", "HABILITADA_RESSALVAS", "NAO_HABILITADA"].includes(status);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-medium ${classes} ${ESTILO[status]}`}
      title={DICA_STATUS_HABILITACAO[status]}
    >
      {EM_ANDAMENTO.includes(status) && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
      {ROTULO_STATUS_HABILITACAO[status]}
      {mostrarPercentual && ` · ${String(percentual).replace(".", ",")}%`}
    </span>
  );
}
