"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Loader2, XCircle } from "lucide-react";
import { formatDate } from "@/lib/format";

type Notificacao = {
  id: string;
  editalId: string;
  editalTitulo: string;
  orgaoNome: string;
  documentoNome: string;
  validade: string;
  diasRestantes: number;
  vencido: boolean;
};

type AuditoriaComAcao = { editalId: string; editalTitulo: string; orgaoNome: string; mensagem: string };

function rotuloPrazo(dias: number) {
  if (dias < 0) return `Venceu há ${Math.abs(dias)} dia(s)`;
  if (dias === 0) return "Vence hoje";
  if (dias === 1) return "Vence amanhã";
  return `Vence em ${dias} dias`;
}

export function NotificacoesClient() {
  const [notificacoes, setNotificacoes] = useState<Notificacao[]>([]);
  const [auditoriasComAcao, setAuditoriasComAcao] = useState<AuditoriaComAcao[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/notificacoes")
      .then((r) => r.json())
      .then((data) => {
        if (data.notificacoes) setNotificacoes(data.notificacoes);
        if (Array.isArray(data.auditoriasComAcao)) setAuditoriasComAcao(data.auditoriasComAcao);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
      <h1 className="text-2xl font-semibold text-foreground">Notificações</h1>
      <p className="mt-1 text-sm text-muted">
        Auditorias que precisam da sua ajuda e documentos do checklist com validade vencendo em até 2 dias, ou já vencidos.
      </p>

      <div className="mt-8 space-y-3">
        {loading && (
          <div className="flex items-center justify-center py-16 text-muted">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}

        {auditoriasComAcao.map((a) => (
          <Link
            key={a.editalId}
            href={`/editais/${a.editalId}?tab=habilitacao`}
            className="block rounded-2xl border border-warning/40 bg-warning/10 p-4 transition hover:shadow-sm"
          >
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">A auditoria de habilitação precisa da sua ajuda</p>
                <p className="mt-0.5 truncate text-xs text-muted">
                  {a.editalTitulo} — {a.orgaoNome}
                </p>
                <p className="mt-1.5 text-xs text-foreground/80">{a.mensagem}</p>
              </div>
            </div>
          </Link>
        ))}

        {!loading && notificacoes.length === 0 && auditoriasComAcao.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border py-16 text-center">
            <p className="text-sm text-muted">Nenhuma notificação no momento. Tudo em dia.</p>
          </div>
        )}

        {notificacoes.map((n) => (
          <Link
            key={n.id}
            href={`/editais/${n.editalId}?tab=checklist`}
            className={`block rounded-2xl border p-4 transition hover:shadow-sm ${
              n.vencido ? "border-danger/30 bg-danger/5" : "border-warning/30 bg-warning/5"
            }`}
          >
            <div className="flex items-start gap-3">
              {n.vencido ? (
                <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
              ) : (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">{n.documentoNome}</p>
                <p className="mt-0.5 truncate text-xs text-muted">
                  {n.editalTitulo} — {n.orgaoNome}
                </p>
                <p className={`mt-1.5 text-xs font-medium ${n.vencido ? "text-danger" : "text-warning"}`}>
                  {rotuloPrazo(n.diasRestantes)} · validade {formatDate(n.validade)}
                </p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
