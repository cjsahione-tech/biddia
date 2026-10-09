import { Loader2 } from "lucide-react";
import type { HabilitacaoStatusTipo } from "@/lib/types";
import { ROTULO_STATUS_HABILITACAO } from "@/lib/habilitacao";

// Selo colorido do resultado da auditoria de habilitação (cartão do Kanban e tela do edital).
const ESTILO: Record<HabilitacaoStatusTipo, string> = {
  AGUARDANDO: "bg-surface text-muted",
  AUDITANDO: "bg-brand-light text-brand",
  HABILITADA: "bg-accent/10 text-accent",
  HABILITADA_RESSALVAS: "bg-warning/10 text-warning",
  NAO_HABILITADA: "bg-danger/10 text-danger",
  ERRO: "bg-muted/10 text-muted",
};

export function SeloHabilitacao({
  status,
  percentual,
  tamanho = "pequeno",
}: {
  status: HabilitacaoStatusTipo;
  percentual?: number | null;
  tamanho?: "pequeno" | "normal";
}) {
  const classes = tamanho === "pequeno" ? "px-1.5 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs";
  const mostrarPercentual = percentual != null && ["HABILITADA", "HABILITADA_RESSALVAS", "NAO_HABILITADA"].includes(status);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-medium ${classes} ${ESTILO[status]}`}
      title="Resultado da conferência automática dos documentos exigidos pelo edital contra a documentação da empresa"
    >
      {status === "AUDITANDO" && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
      {ROTULO_STATUS_HABILITACAO[status]}
      {mostrarPercentual && ` · ${String(percentual).replace(".", ",")}%`}
    </span>
  );
}
