"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Clock, Download, FileText, Loader2, MapPin, RefreshCw } from "lucide-react";
import { SeloHabilitacao } from "@/components/editais/SeloHabilitacao";
import type { HabilitacaoStatusTipo } from "@/lib/types";
import { CUSTO_MEDIO_AUDITORIA_USD, custoEstimadoBrl, etapaAudita } from "@/lib/habilitacao";
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

const brl = (n: number) => n.toFixed(2).replace(".", ",");

export function HabilitacaoTab({ editalId, etapa, onMudou }: { editalId: string; etapa?: string; onMudou?: () => void }) {
  const [relatorio, setRelatorio] = useState<RelatorioHabilitacao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [pedindo, setPedindo] = useState(false);
  const [erroPedido, setErroPedido] = useState<string | null>(null);

  // "Auditar agora" / "Tentar novamente": gasta IA, então pede confirmação mostrando o custo.
  async function pedirAuditoria() {
    const custo = `cerca de US$ ${CUSTO_MEDIO_AUDITORIA_USD.toFixed(2).replace(".", ",")} (aprox. R$ ${brl(custoEstimadoBrl(1))})`;
    if (!window.confirm(`A auditoria usa IA e custa em média ${custo} por edital. Deseja auditar agora?`)) return;
    setPedindo(true);
    setErroPedido(null);
    try {
      const res = await fetch(`/api/editais/${editalId}/habilitacao/solicitar`, { method: "POST" });
      if (!res.ok) throw new Error();
      await carregar();
      onMudou?.();
    } catch {
      setErroPedido("Não foi possível pedir a auditoria agora. Tente novamente em instantes.");
    } finally {
      setPedindo(false);
    }
  }

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
    // busca inicial ao abrir a aba
    carregar();
  }, [carregar]);

  // Fora de Qualificação, um registro antigo (erro ou "rodando" parado, de antes da regra "só audita
  // em Qualificação") não vale: o edital conta como "ainda não auditado". Auditorias pedidas pelo
  // fluxo atual (solicitadaEm preenchido, ex.: botão "Auditar agora") continuam valendo.
  const foraDeEtapa = !!etapa && !etapaAudita(etapa);
  const legado = foraDeEtapa && relatorio?.auditoria?.estado !== "CONCLUIDA" && !relatorio?.auditoria?.solicitadaEm;
  const status = legado ? "AGUARDANDO" : (relatorio?.status ?? "AGUARDANDO");
  const auditoria = legado ? null : (relatorio?.auditoria ?? null);

  // Enquanto a auditoria está rodando, acompanha sozinho.
  const emAndamento =
    ["RODANDO", "NA_FILA", "AGUARDANDO_SALDO", "INTERROMPIDA"].includes(auditoria?.estado ?? "") ||
    ["AUDITANDO", "NA_FILA", "AGUARDANDO_IA", "TEMPO_ESGOTADO", "EDITAL_GRANDE"].includes(status);
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

  const { resumo } = relatorio;
  const concluida = auditoria?.estado === "CONCLUIDA";
  const semResultadoAinda = status === "AGUARDANDO";
  // "Aguardando IA" e "tempo esgotado" se resolvem sozinhos: aparecem como aviso calmo, não como erro.
  const seResolveSozinho =
    ["AGUARDANDO_IA", "TEMPO_ESGOTADO", "NA_FILA", "EDITAL_GRANDE"].includes(status) || auditoria?.estado === "AGUARDANDO_SALDO" || !!auditoria?.retentativaAgendada;
  const comErro = !concluida && !seResolveSozinho && (status === "ERRO" || status === "ARQUIVO_ILEGIVEL" || auditoria?.estado === "ERRO");

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border bg-surface/40 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Habilitação da empresa neste edital</h3>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <SeloHabilitacao status={status as HabilitacaoStatusTipo} percentual={relatorio.percentual} tamanho="normal" etapa={legado ? etapa : undefined} />
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
            Sessão em {dataBr(auditoria!.dataReferencia)} · auditado em {dataHoraBr(auditoria!.concluidaEm)} · atualizado sozinho quando a documentação da empresa muda.{" "}
            <button onClick={pedirAuditoria} disabled={pedindo} className="font-medium text-brand hover:underline disabled:opacity-60">
              Auditar novamente
            </button>
          </p>
        )}
      </div>

      {emAndamento && !concluida && (
        <div className="flex items-start gap-3 rounded-xl border border-border bg-background p-4 text-sm text-muted">
          <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
          <p>
            {status === "AUDITANDO"
              ? "Lendo o edital, o termo de referência e os anexos por inteiro e conferindo com a documentação da empresa… isso pode levar alguns minutos."
              : seResolveSozinho && auditoria?.mensagem
                ? auditoria.mensagem
                : "A auditoria vai começar em instantes. Esta tela atualiza assim que houver resultado."}
            {auditoria?.andamento && <span className="mt-1 block font-medium text-foreground">{auditoria.andamento}</span>}
          </p>
        </div>
      )}

      {semResultadoAinda && !concluida && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background p-4 text-sm text-muted">
          <p className="flex min-w-0 flex-1 items-start gap-3">
            <Clock className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {etapa && etapaAudita(etapa)
                ? "Este edital ainda não tem auditoria de habilitação."
                : "Este edital será auditado automaticamente quando entrar em Qualificação — assim a IA só é usada nos editais que você vai disputar."}
            </span>
          </p>
          <button
            onClick={pedirAuditoria}
            disabled={pedindo}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground hover:bg-border/30 disabled:opacity-60"
          >
            {pedindo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Auditar agora
          </button>
        </div>
      )}

      {erroPedido && <p className="text-sm text-danger">{erroPedido}</p>}

      {auditoria?.avisoAdmin && !concluida && (
        <div className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/5 p-4 text-sm text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            <span className="font-medium">Aviso para o administrador:</span> {auditoria.avisoAdmin}
          </p>
        </div>
      )}

      {!concluida && auditoria && auditoria.arquivosComProblema.length > 0 && (
        <div className="rounded-xl border border-border bg-background p-4 text-sm">
          <p className="font-medium text-foreground">Arquivos que não consegui ler</p>
          <ul className="mt-2 space-y-2">
            {auditoria.arquivosComProblema.map((a) => (
              <li key={a.nome} className="text-xs text-muted">
                <span className="font-medium text-foreground">{a.nome}</span> — {a.problema} <span className="text-foreground/80">{a.oQueFazer}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {comErro && (
        <div className="flex items-start gap-3 rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="min-w-0 flex-1">{auditoria?.mensagem ?? "Não foi possível concluir a auditoria deste edital."}</p>
          <button
            onClick={pedirAuditoria}
            disabled={pedindo}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-danger/30 bg-background px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger/10 disabled:opacity-60"
          >
            {pedindo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Tentar novamente
          </button>
        </div>
      )}

      {concluida && auditoria && !auditoria.leituraCompleta && (
        <div className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/5 p-4 text-sm text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0">
            <p>Nem todos os documentos do processo puderam ser lidos por inteiro. Confira manualmente se há mais exigências neles:</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-xs">
              {auditoria.arquivosComProblema.map((a) => (
                <li key={a.nome}>
                  <span className="font-medium">{a.nome}</span> — {a.problema} {a.oQueFazer}
                </li>
              ))}
            </ul>
          </div>
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
