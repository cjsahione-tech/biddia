"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Download, FileText, Loader2, MapPin } from "lucide-react";
import { SeloHabilitacao } from "@/components/editais/SeloHabilitacao";
import type { HabilitacaoStatusTipo } from "@/lib/types";
import type { ItemRelatorio, RelatorioHabilitacao } from "@/lib/habilitacao-relatorio";

const AVISO_IA = "Gerado por IA. Confirme com o analista responsável antes de enviar a proposta.";

const ESTILO_SITUACAO: Record<string, string> = {
  NAO_ENVIADA: "bg-danger/10 text-danger",
  VENCIDA: "bg-danger/10 text-danger",
  VERIFICAR: "bg-warning/10 text-warning",
  ATENDIDA: "bg-accent/10 text-accent",
  NAO_SE_APLICA: "bg-surface text-muted",
};

const dataHoraBr = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }) : "—";
const dataBr = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—");

function CartaoPendencia({ item }: { item: ItemRelatorio }) {
  const precisaEnviar = item.situacao === "NAO_ENVIADA" || item.situacao === "VENCIDA";
  return (
    <div className="rounded-xl border border-border bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 flex-1 text-sm font-medium text-foreground">{item.documento}</p>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${ESTILO_SITUACAO[item.situacao]}`}>{item.situacaoTexto}</span>
      </div>
      {(item.localizacao || item.origem) && (
        <p className="mt-1.5 flex items-start gap-1.5 text-xs text-muted">
          <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            Onde aparece: {[item.localizacao, item.origem].filter(Boolean).join(" — ")}
          </span>
        </p>
      )}
      {item.condicao && <p className="mt-1 text-xs text-muted">Condição informada no edital: {item.condicao}</p>}
      {item.acaoSugerida && (
        <p className="mt-2 text-sm text-foreground/80">
          <span className="font-medium text-foreground">O que fazer:</span> {item.acaoSugerida}
        </p>
      )}
      {item.observacao && item.situacao !== "NAO_ENVIADA" && <p className="mt-1 text-xs text-muted">{item.observacao}</p>}
      {precisaEnviar && (
        <Link href="/documentos" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
          <FileText className="h-3 w-3" /> Ir para Documentos
        </Link>
      )}
    </div>
  );
}

export function HabilitacaoTab({ editalId }: { editalId: string }) {
  const [relatorio, setRelatorio] = useState<RelatorioHabilitacao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    try {
      const res = await fetch(`/api/editais/${editalId}/habilitacao`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Erro ao carregar");
      setRelatorio(data.relatorio);
      setErro(null);
    } catch {
      setErro("Não foi possível carregar o relatório de habilitação. Tente novamente em instantes.");
    } finally {
      setCarregando(false);
    }
  }, [editalId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- busca inicial ao abrir a aba
    carregar();
  }, [carregar]);

  // Enquanto a auditoria está rodando (ou ainda não começou), acompanha sozinho.
  const emAndamento = relatorio?.auditoria?.estado === "RODANDO" || relatorio?.status === "AUDITANDO" || relatorio?.status === "AGUARDANDO";
  useEffect(() => {
    if (!emAndamento) return;
    const t = setInterval(carregar, 5000);
    return () => clearInterval(t);
  }, [emAndamento, carregar]);

  if (carregando) {
    return (
      <div className="flex items-center justify-center py-16 text-muted">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }
  if (erro || !relatorio) return <p className="text-sm text-danger">{erro ?? "Relatório indisponível."}</p>;

  const { auditoria, resumo, status } = relatorio;
  const concluida = auditoria?.estado === "CONCLUIDA";
  const semResultadoAinda = status === "AGUARDANDO" && !auditoria;
  const comErro = status === "ERRO" || (auditoria?.estado === "ERRO" && !concluida);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border bg-surface/40 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Habilitação da empresa neste edital</h3>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <SeloHabilitacao status={status as HabilitacaoStatusTipo} percentual={relatorio.percentual} tamanho="normal" />
              {concluida && (
                <span className="text-xs text-muted">
                  {resumo.exigidas} exigidos · {resumo.atendidas} atendidos · {resumo.pendentes} pendentes
                </span>
              )}
            </div>
          </div>
          {concluida && (
            <a
              href={`/api/editais/${editalId}/habilitacao/relatorio`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface"
            >
              <Download className="h-3.5 w-3.5" /> Baixar PDF / imprimir
            </a>
          )}
        </div>

        {concluida && relatorio.percentual != null && (
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-border/60" aria-hidden>
            <div
              className={`h-full rounded-full ${status === "HABILITADA" ? "bg-accent" : status === "HABILITADA_RESSALVAS" ? "bg-warning" : "bg-danger"}`}
              style={{ width: `${Math.min(100, relatorio.percentual)}%` }}
            />
          </div>
        )}
        {concluida && (
          <p className="mt-3 text-xs text-muted">
            Sessão em {dataBr(auditoria!.dataReferencia)} · auditado em {dataHoraBr(auditoria!.concluidaEm)} · atualizado sozinho quando a documentação da empresa muda.
          </p>
        )}
      </div>

      {(emAndamento || semResultadoAinda) && !concluida && (
        <div className="flex items-start gap-3 rounded-xl border border-border bg-background p-4 text-sm text-muted">
          <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
          <p>
            {status === "AUDITANDO"
              ? "Lendo o edital, o termo de referência e os anexos por inteiro e conferindo com a documentação da empresa… isso pode levar alguns minutos."
              : "A auditoria começa sozinha logo depois que o edital é captado. Esta tela atualiza assim que houver resultado."}
          </p>
        </div>
      )}

      {comErro && (
        <div className="flex items-start gap-3 rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Não foi possível concluir a auditoria deste edital{auditoria?.mensagem ? `: ${auditoria.mensagem}` : "."} O sistema tenta de novo sozinho; se persistir, envie o
            edital em PDF na tela de Editais.
          </p>
        </div>
      )}

      {concluida && auditoria && !auditoria.leituraCompleta && (
        <div className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/5 p-4 text-sm text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Nem todos os documentos do processo puderam ser lidos por inteiro
            {auditoria.documentosLidos.some((d) => !d.ok) ? ` (${auditoria.documentosLidos.filter((d) => !d.ok).map((d) => d.nome).join("; ")})` : ""}. Confira manualmente se há mais
            exigências neles.
          </p>
        </div>
      )}

      {concluida && resumo.pendentes === 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-accent/30 bg-accent/5 p-4 text-sm text-accent">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <p>Sem pendências: todos os documentos exigidos estão enviados e válidos na data da sessão.</p>
        </div>
      )}

      {concluida &&
        relatorio.pendencias.map((grupo) => (
          <section key={grupo.categoria}>
            <h4 className="text-sm font-semibold text-foreground">
              {grupo.titulo} <span className="font-normal text-muted">({grupo.itens.length} pendente(s))</span>
            </h4>
            <div className="mt-2 space-y-2">
              {grupo.itens.map((item) => (
                <CartaoPendencia key={item.id} item={item} />
              ))}
            </div>
          </section>
        ))}

      {concluida && relatorio.atendidas.length > 0 && (
        <details className="rounded-xl border border-border">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-foreground">Documentos já atendidos ({relatorio.atendidas.length})</summary>
          <ul className="space-y-2 border-t border-border px-4 py-3 text-sm">
            {relatorio.atendidas.map((i) => (
              <li key={i.id} className="flex flex-wrap items-start justify-between gap-2">
                <span className="min-w-0 flex-1 text-foreground">{i.documento}</span>
                <span className="text-xs text-muted">
                  {i.localizacao ?? i.origem} · {i.validade ? `válido até ${new Date(i.validade).toLocaleDateString("pt-BR", { timeZone: "UTC" })}` : "não vence"}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {concluida && relatorio.naoSeAplicam.length > 0 && (
        <details className="rounded-xl border border-border">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-foreground">Exigências que não se aplicam a esta empresa ({relatorio.naoSeAplicam.length})</summary>
          <ul className="space-y-2 border-t border-border px-4 py-3 text-sm">
            {relatorio.naoSeAplicam.map((i) => (
              <li key={i.id} className="flex flex-wrap items-start justify-between gap-2">
                <span className="min-w-0 flex-1 text-foreground">{i.documento}</span>
                <span className="text-xs text-muted">vale somente para: {i.aplicavelSe ?? "—"}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <p className="text-xs text-muted">{AVISO_IA}</p>
    </div>
  );
}
