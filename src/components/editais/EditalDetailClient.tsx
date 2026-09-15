"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ExternalLink, Loader2 } from "lucide-react";
import { formatValorEdital, formatDate } from "@/lib/format";
import { ETAPAS_KANBAN } from "@/lib/kanban";
import { labelVerNoPortal } from "@/lib/fonte-edital";
import type { EditalDetail, EtapaKanban } from "@/lib/types";
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
  const searchParams = useSearchParams();
  const tabInicial =
    (TABS.find((t) => t.key === searchParams.get("tab"))?.key as (typeof TABS)[number]["key"] | undefined) ??
    "analise";

  const [edital, setEdital] = useState<EditalDetail | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>(tabInicial);
  const [movendoEtapa, setMovendoEtapa] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/editais/${editalId}`);
    const data = await res.json();
    if (res.ok) setEdital(data.edital);
  }, [editalId]);

  async function moverEtapa(etapaKanban: EtapaKanban) {
    setMovendoEtapa(true);
    try {
      const res = await fetch(`/api/editais/${editalId}/kanban`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ etapaKanban, ordemKanban: Date.now() }),
      });
      if (res.ok) await load();
    } finally {
      setMovendoEtapa(false);
    }
  }

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
            <span className="text-xs text-muted">
              {edital.fonte === "MANUAL" ? "Adicionado manualmente" : edital.numeroControlePNCP}
            </span>
          </div>
          <h1 className="mt-2 text-2xl font-semibold text-foreground">{edital.titulo}</h1>
          <p className="mt-1 text-sm text-muted">
            {edital.orgaoNome} — {edital.municipio ?? "?"}/{edital.uf ?? "?"}
          </p>

          <div className="mt-3 flex items-center gap-2">
            <label htmlFor="etapaKanban" className="text-xs font-medium text-muted">
              Etapa
            </label>
            <select
              id="etapaKanban"
              value={edital.etapaKanban}
              onChange={(e) => moverEtapa(e.target.value as EtapaKanban)}
              disabled={movendoEtapa}
              className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
            >
              {ETAPAS_KANBAN.map((et) => (
                <option key={et.key} value={et.key}>
                  {et.label}
                </option>
              ))}
            </select>
            {movendoEtapa && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted" />}
          </div>
          {edital.status === "NOVO" && (
            <p className="mt-1.5 text-xs text-muted">
              Os agentes de IA começam a analisar assim que este card sai de &ldquo;Oportunidade&rdquo;.
            </p>
          )}
        </div>
        <div className="shrink-0 text-right">
          <p
            className={`text-xl font-semibold ${edital.orcamentoSigiloso ? "text-muted italic" : "text-foreground"}`}
          >
            {formatValorEdital(edital.valorGlobal, edital.orcamentoSigiloso)}
          </p>
          <p className="mt-1 text-xs text-muted">Encerra {formatDate(edital.dataEncerramentoProposta)}</p>
          {edital.linkPortal && (
            <a
              href={edital.linkPortal}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-brand hover:underline"
            >
              {labelVerNoPortal(edital.fonte)} <ExternalLink className="h-3 w-3" />
            </a>
          )}
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
        {tab === "analise" && <AnalysisTab edital={edital} onUpdate={load} />}
        {tab === "financeiro" && <FinanceTab edital={edital} onUpdate={load} />}
        {tab === "documentos" && (
          <DocumentsTab editalId={edital.id} documents={edital.documents} onUpdate={load} />
        )}
        {tab === "checklist" && (
          <ChecklistTab editalId={edital.id} items={edital.checklistItems} onUpdate={load} />
        )}
        {tab === "auditoria" && <AuditTab editalId={edital.id} logs={edital.auditLogs} onUpdate={load} />}
      </div>
    </div>
  );
}
