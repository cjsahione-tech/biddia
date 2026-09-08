"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ExternalLink, Loader2 } from "lucide-react";
import { formatValorEdital, formatDate } from "@/lib/format";
import type { EditalDetail } from "@/lib/types";
import { PipelineStatus } from "@/components/editais/PipelineStatus";
import { AnalysisTab } from "@/components/editais/tabs/AnalysisTab";
import { FinanceTab } from "@/components/editais/tabs/FinanceTab";
import { DocumentsTab } from "@/components/editais/tabs/DocumentsTab";
import { ChecklistTab } from "@/components/editais/tabs/ChecklistTab";
import { AuditTab } from "@/components/editais/tabs/AuditTab";

const TABS = [
  { key: "analise", label: "Análise" },
  { key: "financeiro", label: "Financeiro" },
  { key: "documentos", label: "Documentos" },
  { key: "checklist", label: "Checklist" },
  { key: "auditoria", label: "Auditoria" },
] as const;

export function EditalDetailClient({ editalId }: { editalId: string }) {
  const [edital, setEdital] = useState<EditalDetail | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("analise");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/editais/${editalId}`);
    const data = await res.json();
    if (res.ok) setEdital(data.edital);
  }, [editalId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- busca inicial ao montar a tela
    load();
  }, [load]);

  useEffect(() => {
    const pipelineDone = edital?.agentRuns?.some(
      (r) => r.agentKey === "agente6-auditor" && r.status !== "RUNNING"
    );
    const shouldPoll = edital?.status === "APROVADO" && !pipelineDone;

    if (shouldPoll && !pollRef.current) {
      pollRef.current = setInterval(load, 2500);
    }
    if (!shouldPoll && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [edital, load]);

  if (!edital) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted" />
      </div>
    );
  }

  const pipelineRunning = edital.status === "APROVADO" && edital.agentRuns.length > 0;

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Voltar
      </Link>

      <div className="mt-4 flex items-start justify-between gap-6">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-brand-light px-2.5 py-0.5 text-xs font-medium text-brand">
              {edital.modalidade ?? "Modalidade não informada"}
            </span>
            <span className="text-xs text-muted">{edital.numeroControlePNCP}</span>
          </div>
          <h1 className="mt-2 text-2xl font-semibold text-foreground">{edital.titulo}</h1>
          <p className="mt-1 text-sm text-muted">
            {edital.orgaoNome} — {edital.municipio ?? "?"}/{edital.uf ?? "?"}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p
            className={`text-xl font-semibold ${edital.orcamentoSigiloso ? "text-muted italic" : "text-foreground"}`}
          >
            {formatValorEdital(edital.valorGlobal, edital.orcamentoSigiloso)}
          </p>
          <p className="mt-1 text-xs text-muted">Encerra {formatDate(edital.dataEncerramentoProposta)}</p>
          <a
            href={edital.linkPortal}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-brand hover:underline"
          >
            Ver no PNCP <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>

      {pipelineRunning && (
        <div className="mt-6">
          <PipelineStatus runs={edital.agentRuns} />
        </div>
      )}

      <div className="mt-8 flex items-center gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition ${
              tab === t.key
                ? "border-brand text-brand"
                : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {tab === "analise" && <AnalysisTab edital={edital} />}
        {tab === "financeiro" && <FinanceTab edital={edital} onUpdate={load} />}
        {tab === "documentos" && <DocumentsTab editalId={edital.id} documents={edital.documents} />}
        {tab === "checklist" && (
          <ChecklistTab editalId={edital.id} items={edital.checklistItems} onUpdate={load} />
        )}
        {tab === "auditoria" && <AuditTab logs={edital.auditLogs} />}
      </div>
    </div>
  );
}
