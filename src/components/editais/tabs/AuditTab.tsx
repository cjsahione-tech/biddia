import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { formatDateTime } from "@/lib/format";
import type { AuditLogItem } from "@/lib/types";

const SEVERITY_CONFIG = {
  OK: { icon: CheckCircle2, className: "text-accent" },
  ALERTA: { icon: AlertTriangle, className: "text-warning" },
  ERRO: { icon: XCircle, className: "text-danger" },
};

export function AuditTab({ logs }: { logs: AuditLogItem[] }) {
  if (logs.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-muted">
        O Agente Auditor ainda não avaliou este edital.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {logs.map((log) => {
        const cfg = SEVERITY_CONFIG[log.severidade];
        return (
          <div key={log.id} className="rounded-xl border border-border p-4">
            <div className="flex items-start gap-3">
              <cfg.icon className={`mt-0.5 h-4 w-4 shrink-0 ${cfg.className}`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-foreground">
                    {log.agente} <span className="font-normal text-muted">— {log.etapa}</span>
                  </p>
                  <span className="shrink-0 text-xs text-muted">{formatDateTime(log.createdAt)}</span>
                </div>
                <p className="mt-1 text-sm text-foreground/80">{log.mensagem}</p>
                {log.acaoTomada && (
                  <p className="mt-1.5 text-xs font-medium text-brand">Ação: {log.acaoTomada}</p>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
