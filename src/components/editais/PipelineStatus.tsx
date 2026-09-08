import { Loader2, CheckCircle2, XCircle, Circle } from "lucide-react";
import type { AgentRunItem } from "@/lib/types";

const ETAPAS: { key: string; label: string }[] = [
  { key: "agente2-analista", label: "Analista" },
  { key: "agente3-financeiro", label: "Financeiro" },
  { key: "agente4-advogado", label: "Advogado" },
  { key: "agente5-secretario", label: "Secretário" },
  { key: "agente6-auditor", label: "Auditor" },
];

function statusOf(agentKey: string, runs: AgentRunItem[]) {
  const relevant = runs.filter((r) => r.agentKey === agentKey);
  if (relevant.length === 0) return "PENDENTE";
  // O mais recente primeiro (agentRuns já vem ordenado desc no backend).
  return relevant[0].status;
}

export function PipelineStatus({ runs }: { runs: AgentRunItem[] }) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto rounded-2xl border border-border bg-surface/60 px-4 py-3">
      {ETAPAS.map((etapa, i) => {
        const status = statusOf(etapa.key, runs);
        return (
          <div key={etapa.key} className="flex items-center gap-1">
            <div className="flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium">
              {status === "RUNNING" && <Loader2 className="h-3.5 w-3.5 animate-spin text-brand" />}
              {status === "DONE" && <CheckCircle2 className="h-3.5 w-3.5 text-accent" />}
              {status === "ERROR" && <XCircle className="h-3.5 w-3.5 text-danger" />}
              {status === "PENDENTE" && <Circle className="h-3.5 w-3.5 text-muted/50" />}
              <span
                className={
                  status === "PENDENTE" ? "text-muted" : status === "ERROR" ? "text-danger" : "text-foreground"
                }
              >
                {etapa.label}
              </span>
            </div>
            {i < ETAPAS.length - 1 && <div className="h-px w-4 bg-border" />}
          </div>
        );
      })}
    </div>
  );
}
