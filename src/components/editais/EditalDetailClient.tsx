"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ExternalLink, Loader2 } from "lucide-react";
import { descreverValorEdital, formatDate } from "@/lib/format";
import { ETAPAS_KANBAN } from "@/lib/kanban";
import { labelVerNoPortal } from "@/lib/fonte-edital";
import type { EditalDetail, EtapaKanban } from "@/lib/types";
import { PipelineStatus } from "@/components/editais/PipelineStatus";
import { AnalysisTab } from "@/components/editais/tabs/AnalysisTab";
import { FinanceTab } from "@/components/editais/tabs/FinanceTab";
import { DocumentsTab } from "@/components/editais/tabs/DocumentsTab";
import { ChecklistTab } from "@/components/editais/tabs/ChecklistTab";
import { AuditTab } from "@/components/editais/tabs/AuditTab";
import { SeloHabilitacao } from "@/components/editais/SeloHabilitacao";
import { HabilitacaoTab } from "@/components/editais/tabs/HabilitacaoTab";
import { ViabilidadeTab } from "@/components/editais/tabs/ViabilidadeTab";
import { Abas } from "@/components/ui/Abas";
import { Cartao } from "@/components/ui/Cartao";
import { Chip } from "@/components/ui/Chip";

// Abas do edital (as mesmas em qualquer tela; no celular rolam para o lado). "Documentos" guarda as declarações e anexos
// que o Agente Advogado gera; "Auditoria" é o histórico dos agentes.
const TABS = [
  { chave: "analise", rotulo: "Análise" },
  { chave: "viabilidade", rotulo: "Viabilidade" },
  { chave: "habilitacao", rotulo: "Habilitação" },
  { chave: "financeiro", rotulo: "Financeiro" },
  { chave: "documentos", rotulo: "Documentos" },
  { chave: "checklist", rotulo: "Checklist" },
  { chave: "auditoria", rotulo: "Auditoria" },
] as const;
type ChaveAba = (typeof TABS)[number]["chave"];

export function EditalDetailClient({ editalId }: { editalId: string }) {
  const searchParams = useSearchParams();
  const tabInicial = (TABS.find((t) => t.chave === searchParams.get("tab"))?.chave as ChaveAba | undefined) ?? "analise";

  const [edital, setEdital] = useState<EditalDetail | null>(null);
  const [tab, setTab] = useState<ChaveAba>(tabInicial);
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
    // Também acompanha quando o card volta para Qualificação e a esteira roda de novo: o
    // Auditor da rodada anterior já está "concluído", mas há agentes novos em execução.
    const algumRodando = edital?.agentRuns?.some((r) => r.status === "RUNNING");
    const shouldPoll = edital?.status === "APROVADO" && (!pipelineDone || !!algumRodando);

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

  const valor = descreverValorEdital(edital);

  return (
    <div className="mx-auto w-full max-w-[var(--content-max)] px-[var(--gutter)] pb-8 pt-5 md:pt-8">
      <Link href="/editais" className="tipo-corpo-forte inline-flex min-h-11 items-center gap-1.5 text-brand-600">
        <ArrowLeft className="h-4 w-4" /> Editais
      </Link>

      <Cartao className="mt-1 flex flex-col gap-4 md:flex-row md:items-start md:justify-between md:gap-6 md:p-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Chip>{edital.modalidade ?? "Modalidade não informada"}</Chip>
            <span className="tipo-pequeno text-ink-muted">{edital.fonte === "MANUAL" ? "Adicionado manualmente" : edital.numeroControlePNCP}</span>
            <SeloHabilitacao status={edital.habilitacaoStatus} percentual={edital.habilitacaoPercentual} tamanho="normal" etapa={edital.etapaKanban} />
            {["HABILITADA_RESSALVAS", "NAO_HABILITADA", "REVISAR_MANUALMENTE", "PRECISA_ACAO_HUMANA"].includes(edital.habilitacaoStatus) && (
              <button onClick={() => setTab("habilitacao")} className="tipo-pequeno font-bold text-brand-600 hover:underline">
                Ver pendências
              </button>
            )}
          </div>
          <h1 className="tipo-titulo-pagina mt-2 break-words text-ink">{edital.titulo}</h1>
          <p className="tipo-corpo mt-1 text-ink-muted">
            {edital.orgaoNome} — {edital.municipio ?? "?"}/{edital.uf ?? "?"}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label htmlFor="etapaKanban" className="tipo-pequeno font-bold text-ink-muted">
              Etapa
            </label>
            <select
              id="etapaKanban"
              value={edital.etapaKanban}
              onChange={(e) => moverEtapa(e.target.value as EtapaKanban)}
              disabled={movendoEtapa}
              className="min-h-11 rounded-tile border border-border bg-surface px-3 text-[13px] font-bold text-ink focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-focus-ring/30"
            >
              {ETAPAS_KANBAN.map((et) => (
                <option key={et.key} value={et.key}>
                  {et.label}
                </option>
              ))}
            </select>
            {movendoEtapa && <Loader2 className="h-4 w-4 animate-spin text-ink-muted" />}
          </div>
          {edital.status === "NOVO" && (
            <p className="tipo-pequeno mt-1.5 text-ink-muted">
              Os agentes de IA começam a analisar assim que este card vai para &ldquo;Qualificação&rdquo;.
            </p>
          )}
        </div>
        <div className="shrink-0 border-t border-border pt-3 md:border-t-0 md:pt-0 md:text-right">
          <p className={`tipo-numero ${valor.apagado ? "italic text-ink-muted" : "text-ink"}`}>{valor.texto}</p>
          {valor.nota && <p className="tipo-pequeno mt-0.5 max-w-xs text-ink-muted md:ml-auto">{valor.nota}</p>}
          <p className="tipo-pequeno mt-1 tabular-nums text-ink-muted">Encerra {formatDate(edital.dataEncerramentoProposta)}</p>
          {edital.linkPortal && (
            <a href={edital.linkPortal} target="_blank" rel="noreferrer" className="tipo-pequeno mt-1 inline-flex min-h-11 items-center gap-1.5 font-bold text-brand-600 hover:underline">
              {labelVerNoPortal(edital.fonte)} <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </Cartao>

      {pipelineRunning && (
        <div className="mt-4">
          <PipelineStatus runs={edital.agentRuns} />
        </div>
      )}

      <Abas
        className="mt-5"
        rotuloAcessivel="Abas do edital"
        itens={TABS.map((t) => ({ chave: t.chave, rotulo: t.rotulo }))}
        ativa={tab}
        onChange={(c) => setTab(c as ChaveAba)}
      />

      <div className="mt-5">
        {tab === "analise" && <AnalysisTab edital={edital} onUpdate={load} />}
        {tab === "viabilidade" && <ViabilidadeTab editalId={edital.id} />}
        {tab === "habilitacao" && <HabilitacaoTab editalId={edital.id} etapa={edital.etapaKanban} onMudou={load} />}
        {tab === "financeiro" && <FinanceTab edital={edital} onUpdate={load} />}
        {tab === "documentos" && <DocumentsTab editalId={edital.id} documents={edital.documents} onUpdate={load} />}
        {tab === "checklist" && <ChecklistTab editalId={edital.id} items={edital.checklistItems} onUpdate={load} />}
        {tab === "auditoria" && <AuditTab editalId={edital.id} logs={edital.auditLogs} onUpdate={load} />}
      </div>
    </div>
  );
}
