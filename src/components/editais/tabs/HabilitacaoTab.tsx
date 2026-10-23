"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Check, CheckCircle2, Clock, Download, FileText, Loader2, MapPin, Paperclip, RefreshCw } from "lucide-react";
import { FormularioEnvioDocumento } from "@/components/documentos/FormularioEnvioDocumento";
import { SeloHabilitacao } from "@/components/editais/SeloHabilitacao";
import type { HabilitacaoStatusTipo } from "@/lib/types";
import { CUSTO_MEDIO_AUDITORIA_USD, custoEstimadoBrl, etapaAudita } from "@/lib/habilitacao";
import { CUSTO_POR_PAGINA_OCR_USD, TETO_CUSTO_LIBERADO_USD } from "@/lib/auditoria-politica";
import { TETO_PAGINAS_OCR as TETO_PAGINAS_POR_EDITAL } from "@/lib/limites-leitura";
import type { AcaoHumana } from "@/lib/ia-erros";
import type { ItemRelatorio, RelatorioHabilitacao } from "@/lib/habilitacao-relatorio";

const AVISO_IA = "Gerado por IA. Confirme com o analista responsável antes de enviar a proposta.";

const ESTILO_SITUACAO: Record<string, string> = {
  NAO_ENVIADA: "bg-danger-bg text-danger-ink",
  VENCIDA: "bg-danger-bg text-danger-ink",
  VERIFICAR: "bg-warning-bg text-warning-ink",
  ATENDIDA: "bg-success-bg text-success-ink",
  NAO_SE_APLICA: "bg-surface text-muted",
};

const dataHoraBr = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }) : "—";
const dataBr = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—");

const ESTILO_SELO_DOCUMENTO: Record<string, string> = {
  LIDO: "bg-success-bg text-success-ink",
  PARCIAL: "bg-warning-bg text-warning-ink",
  LENDO: "bg-brand-light text-brand",
  AGUARDANDO: "bg-warning-bg text-warning-ink",
  NAO_LIDO: "bg-danger-bg text-danger-ink",
};

type AuditoriaRelatorio = NonNullable<RelatorioHabilitacao["auditoria"]>;

/** Quadro único: todos os documentos do processo, o selo de leitura de cada um e o que fazer quando algum não foi lido por inteiro. */
function DocumentosAnalisados({ auditoria, concluida }: { auditoria: AuditoriaRelatorio; concluida: boolean }) {
  if (auditoria.documentos.length === 0) return null;
  const comProblema = auditoria.documentos.some((d) => d.selo !== "LIDO");
  // Sem resultado ainda e nada com problema: o andamento já é mostrado em outro aviso.
  if (!concluida && !comProblema) return null;
  return (
    <details open={comProblema} className="rounded-card bg-surface shadow-card text-sm">
      <summary className="cursor-pointer select-none px-4 py-3 font-medium text-foreground">
        Documentos analisados <span className="font-normal text-muted">— {auditoria.resumoLeitura.texto}</span>
      </summary>
      <ul className="divide-y divide-border border-t border-border">
        {auditoria.documentos.map((d) => (
          <li key={d.nome} className="px-4 py-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <FileText className="h-3.5 w-3.5 shrink-0 text-muted" />
              <span className="min-w-0 flex-1 break-words text-xs font-medium text-foreground">{d.nome}</span>
              <span
                className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-medium text-muted"
                title={
                  d.papel === "principal"
                    ? "Edital, termo de referência, preços e planilhas: se não forem lidos por inteiro, o resultado fica com ressalva."
                    : "Anexo de apoio: se não for lido por inteiro, só avisamos; o resultado não muda."
                }
              >
                {d.papel === "principal" ? "Principal" : "Apoio"}
              </span>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${ESTILO_SELO_DOCUMENTO[d.selo]}`}>{d.rotulo}</span>
            </div>
            {d.problema && (
              <p className="mt-1 pl-5 text-xs text-muted">
                {d.problema} <span className="text-foreground/80">{d.oQueFazer}</span>
              </p>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

const LIMITE_ENVIO_BYTES = 3.5 * 1024 * 1024;
const CATEGORIAS_DE_ENVIO = [
  { valor: "EDITAL", rotulo: "Edital" },
  { valor: "TERMO_REFERENCIA", rotulo: "Termo de referência" },
  { valor: "ANEXO_PRECOS", rotulo: "Anexo de preços / planilha" },
] as const;

/** "Precisa de ação humana": explica em português simples o que travou e oferece o botão certo. */
function CartaoAcaoHumana({
  editalId,
  mensagem,
  acoes,
  ocupado,
  onTentarDeNovo,
  onLiberarLeitura,
  onArquivoEnviado,
}: {
  editalId: string;
  mensagem: string | null;
  acoes: AcaoHumana[];
  ocupado: boolean;
  onTentarDeNovo: () => void;
  onLiberarLeitura: () => void;
  onArquivoEnviado: () => void;
}) {
  const [enviando, setEnviando] = useState(false);
  const [categoria, setCategoria] = useState<(typeof CATEGORIAS_DE_ENVIO)[number]["valor"]>("EDITAL");
  const [erro, setErro] = useState<string | null>(null);

  async function enviar(arquivo: File | undefined) {
    if (!arquivo) return;
    setErro(null);
    if (arquivo.size > LIMITE_ENVIO_BYTES) {
      setErro("Arquivo grande demais para enviar por aqui (limite de 3,5 MB). Envie só as páginas de habilitação, ou divida o PDF em partes.");
      return;
    }
    setEnviando(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const leitor = new FileReader();
        leitor.onload = () => resolve(String(leitor.result).split(",")[1] ?? "");
        leitor.onerror = () => reject(new Error("leitura"));
        leitor.readAsDataURL(arquivo);
      });
      const res = await fetch(`/api/editais/${editalId}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: arquivo.name, arquivoBase64: base64, categoria }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "envio");
      onArquivoEnviado();
    } catch (e) {
      setErro(e instanceof Error && e.message !== "envio" && e.message !== "leitura" ? e.message : "Não consegui enviar o arquivo. Tente novamente.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="rounded-xl border border-warning-ink/40 bg-warning-bg p-4 text-sm">
      <div className="flex items-start gap-3 text-warning-ink">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">Precisa da sua ajuda para continuar</p>
          <p className="mt-1 text-xs text-foreground/80">{mensagem ?? "A auditoria parou porque só uma pessoa resolve."}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 pl-7">
        {acoes.includes("enviar_arquivo") && (
          <>
            <select
              value={categoria}
              onChange={(e) => setCategoria(e.target.value as typeof categoria)}
              className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground"
              aria-label="Que arquivo você vai enviar"
            >
              {CATEGORIAS_DE_ENVIO.map((c) => (
                <option key={c.valor} value={c.valor}>
                  {c.rotulo}
                </option>
              ))}
            </select>
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-brand/30 bg-brand-light/30 px-3 py-1.5 text-xs font-medium text-brand hover:bg-brand-light/60">
              {enviando || ocupado ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />} Enviar arquivo
              <input
                type="file"
                accept=".pdf,.doc,.docx,.xlsx,.csv,.txt"
                className="hidden"
                disabled={enviando || ocupado}
                onChange={(e) => {
                  void enviar(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
          </>
        )}
        {acoes.includes("liberar_leitura") && (
          <button
            onClick={() => {
              if (window.confirm(`Liberar a leitura completa eleva o limite de custo deste edital para US$ ${TETO_CUSTO_LIBERADO_USD.toFixed(2).replace(".", ",")}. Confirma?`)) onLiberarLeitura();
            }}
            disabled={ocupado}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface disabled:opacity-60"
          >
            <FileText className="h-3.5 w-3.5" /> Liberar leitura completa (custo extra)
          </button>
        )}
        {acoes.includes("tentar_de_novo") && (
          <button
            onClick={onTentarDeNovo}
            disabled={ocupado}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface disabled:opacity-60"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Tentar de novo
          </button>
        )}
      </div>
      {erro && <p className="mt-2 pl-7 text-xs text-danger-ink">{erro}</p>}
    </div>
  );
}

function CartaoPendencia({ item, onAnexado }: { item: ItemRelatorio; onAnexado: () => void }) {
  const precisaEnviar = item.situacao === "NAO_ENVIADA" || item.situacao === "VENCIDA";
  const [anexando, setAnexando] = useState(false);
  // "Enviado": vem do banco (documento já na base da empresa) ou, logo após o envio, do próprio clique.
  const [enviadoAgora, setEnviadoAgora] = useState(false);
  const enviado = item.documentoEnviado;
  const mostrarEnviado = !!enviado || enviadoAgora;
  const vencido = item.situacao === "VENCIDA";
  return (
    <div className="rounded-card bg-surface shadow-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 flex-1 text-sm font-medium text-foreground">{item.documento}</p>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          {mostrarEnviado && (
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${vencido ? "bg-warning-bg text-warning-ink" : "bg-success-bg text-success-ink"}`}
              title="Este documento já está na base de documentos da empresa"
            >
              <Check className="h-3 w-3" /> {vencido ? "Enviado (vencido)" : "Enviado"}
            </span>
          )}
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${ESTILO_SITUACAO[item.situacao]}`}>{item.situacaoTexto}</span>
        </div>
      </div>
      {mostrarEnviado && (
        <p className="mt-1.5 text-xs text-muted">
          {enviado
            ? `${enviado.nome} — enviado em ${new Date(enviado.enviadoEm).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}${enviado.validade ? ` · validade ${new Date(enviado.validade).toLocaleDateString("pt-BR", { timeZone: "UTC" })}` : ""}`
            : "Documento salvo na base de documentos da empresa."}
        </p>
      )}
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
      {!anexando && (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button
            onClick={() => setAnexando(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-brand/30 bg-brand-light/30 px-2.5 py-1 text-xs font-medium text-brand hover:bg-brand-light/60"
          >
            <Paperclip className="h-3.5 w-3.5" /> {vencido ? "Anexar versão atualizada" : mostrarEnviado ? "Substituir documento" : "Anexar documento"}
          </button>
          {precisaEnviar && (
            <Link href="/documentos" className="inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-foreground hover:underline">
              <FileText className="h-3 w-3" /> Ir para Documentos
            </Link>
          )}
        </div>
      )}
      {anexando && (
        <FormularioEnvioDocumento
          // Item do catálogo: o servidor define tipo e categoria. Fora do catálogo: documento personalizado
          // com o nome da exigência já preenchido.
          catalogoChave={item.catalogoChave ?? undefined}
          personalizado={!item.catalogoChave}
          tipoSugerido={item.documento}
          venceTipicamente={item.venceTipicamente}
          titulo={`${vencido ? "Anexar versão atualizada" : mostrarEnviado ? "Substituir documento" : "Anexar documento"}: ${item.documento.slice(0, 90)}`}
          onConcluido={() => {
            setAnexando(false);
            setEnviadoAgora(true);
            onAnexado();
          }}
          onCancelar={() => setAnexando(false)}
        />
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
  const [avisoAnexo, setAvisoAnexo] = useState<string | null>(null);

  // Documento anexado: já entrou no dossiê da empresa (vale para os próximos editais também) e o sistema
  // reavalia a habilitação em segundo plano — recarrega algumas vezes para mostrar a pendência resolvida.
  async function aoAnexar() {
    setAvisoAnexo("Documento salvo na base de documentos da empresa. Reavaliando a habilitação deste edital…");
    // Reavalia ESTE edital agora (mesmo com a sessão já encerrada) e só então recarrega o resultado.
    await fetch(`/api/editais/${editalId}/habilitacao/reavaliar`, { method: "POST" }).catch(() => null);
    await carregar();
    onMudou?.();
    // Documento fora do catálogo é conferido pela IA em segundo plano (alguns segundos): recarrega por ~40s.
    for (const espera of [3000, 6000, 10000, 16000, 24000, 40000]) {
      setTimeout(() => {
        carregar();
        onMudou?.();
      }, espera);
    }
    setTimeout(() => setAvisoAnexo("Documento salvo na base de documentos da empresa — ele também vale para os próximos editais."), 40000);
  }

  // "Auditar agora" / "Tentar novamente": gasta IA, então pede confirmação mostrando o custo.
  async function pedirAuditoria(opts: { liberarLeitura?: boolean; semConfirmar?: boolean } = {}) {
    if (!opts.semConfirmar) {
      const custo = `cerca de US$ ${CUSTO_MEDIO_AUDITORIA_USD.toFixed(2).replace(".", ",")} (aprox. R$ ${brl(custoEstimadoBrl(1))})`;
      if (!window.confirm(`A auditoria usa IA e custa em média ${custo} por edital. Deseja auditar agora?`)) return;
    }
    setPedindo(true);
    setErroPedido(null);
    try {
      const res = await fetch(`/api/editais/${editalId}/habilitacao/solicitar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ liberarLeitura: opts.liberarLeitura === true }),
      });
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
  if (erro || !relatorio) return <p className="text-sm text-danger-ink">{erro ?? "Relatório indisponível."}</p>;

  const { resumo } = relatorio;
  const concluida = auditoria?.estado === "CONCLUIDA";
  const semResultadoAinda = status === "AGUARDANDO";
  // "Aguardando IA" e "tempo esgotado" se resolvem sozinhos: aparecem como aviso calmo, não como erro.
  const seResolveSozinho =
    ["AGUARDANDO_IA", "TEMPO_ESGOTADO", "NA_FILA", "EDITAL_GRANDE"].includes(status) || auditoria?.estado === "AGUARDANDO_SALDO" || !!auditoria?.retentativaAgendada;
  const precisaAcao = !concluida && !!auditoria && auditoria.acoes.length > 0 && !seResolveSozinho;
  const comErro = !concluida && !seResolveSozinho && !precisaAcao && (status === "ERRO" || status === "ARQUIVO_ILEGIVEL" || auditoria?.estado === "ERRO");

  return (
    <div className="space-y-6">
      <div className="rounded-card bg-surface shadow-card p-5">
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

        {concluida && relatorio.percentual != null && status !== "REVISAR_MANUALMENTE" && (
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-border/60" aria-hidden>
            <div
              className={`h-full rounded-full ${status === "HABILITADA" ? "bg-success-ink" : status === "HABILITADA_RESSALVAS" ? "bg-warning-ink" : "bg-danger-ink"}`}
              style={{ width: `${Math.min(100, relatorio.percentual)}%` }}
            />
          </div>
        )}
        {concluida && (
          <p className="mt-3 text-xs text-muted">
            Sessão em {dataBr(auditoria!.dataReferencia)} · auditado em {dataHoraBr(auditoria!.concluidaEm)} · atualizado sozinho quando a documentação da empresa muda.{" "}
            <button onClick={() => pedirAuditoria()} disabled={pedindo} className="font-medium text-brand hover:underline disabled:opacity-60">
              Auditar novamente
            </button>
          </p>
        )}
      </div>

      {emAndamento && !concluida && (
        <div className="flex items-start gap-3 rounded-card bg-surface shadow-card p-4 text-sm text-muted">
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
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-surface shadow-card p-4 text-sm text-muted">
          <p className="flex min-w-0 flex-1 items-start gap-3">
            <Clock className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {etapa && etapaAudita(etapa)
                ? "Este edital ainda não tem auditoria de habilitação."
                : "Este edital será auditado automaticamente quando entrar em Qualificação — assim a IA só é usada nos editais que você vai disputar."}
            </span>
          </p>
          <button
            onClick={() => pedirAuditoria()}
            disabled={pedindo}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground hover:bg-border/30 disabled:opacity-60"
          >
            {pedindo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Auditar agora
          </button>
        </div>
      )}

      {erroPedido && <p className="text-sm text-danger-ink">{erroPedido}</p>}

      {auditoria?.avisoAdmin && !concluida && (
        <div className="flex items-start gap-3 rounded-xl border border-warning-ink/30 bg-warning-bg p-4 text-sm text-warning-ink">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            <span className="font-medium">Aviso para o administrador:</span> {auditoria.avisoAdmin}
          </p>
        </div>
      )}

      {!concluida && auditoria && <DocumentosAnalisados auditoria={auditoria} concluida={false} />}

      {precisaAcao && auditoria && (
        <CartaoAcaoHumana
          editalId={editalId}
          mensagem={auditoria.mensagem}
          acoes={auditoria.acoes}
          ocupado={pedindo}
          onTentarDeNovo={() => pedirAuditoria()}
          onLiberarLeitura={() => pedirAuditoria({ liberarLeitura: true, semConfirmar: true })}
          onArquivoEnviado={() => pedirAuditoria({ semConfirmar: true })}
        />
      )}

      {concluida && auditoria && auditoria.paginasForaDoLimite > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-surface shadow-card p-4 text-sm">
          <p className="min-w-0 flex-1 text-muted">
            <span className="font-medium text-foreground">{auditoria.paginasForaDoLimite} página(s) escaneada(s) ficaram sem leitura</span> pelo limite de {TETO_PAGINAS_POR_EDITAL} páginas por imagem por edital. Se a conferência manual
            não for suficiente, você pode liberar a leitura completa.
          </p>
          <button
            onClick={() => {
              const usd = auditoria.paginasForaDoLimite * CUSTO_POR_PAGINA_OCR_USD;
              if (window.confirm(`Ler as ${auditoria.paginasForaDoLimite} páginas restantes por imagem custa cerca de US$ ${usd.toFixed(2).replace(".", ",")} a mais (aprox. R$ ${brl(custoEstimadoBrl(usd / CUSTO_MEDIO_AUDITORIA_USD))}), além de refazer a conferência. Liberar a leitura completa?`)) {
                pedirAuditoria({ liberarLeitura: true, semConfirmar: true });
              }
            }}
            disabled={pedindo}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-brand/30 bg-brand-light/30 px-3 py-1.5 text-xs font-medium text-brand hover:bg-brand-light/60 disabled:opacity-60"
          >
            {pedindo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />} Liberar leitura completa (custo extra)
          </button>
        </div>
      )}

      {comErro && (
        <div className="flex items-start gap-3 rounded-xl border border-danger-ink/30 bg-danger-bg p-4 text-sm text-danger-ink">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="min-w-0 flex-1">{auditoria?.mensagem ?? "Não foi possível concluir a auditoria deste edital."}</p>
          <button
            onClick={() => pedirAuditoria()}
            disabled={pedindo}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-danger-ink/30 bg-background px-3 py-1.5 text-xs font-medium text-danger-ink hover:bg-danger-bg disabled:opacity-60"
          >
            {pedindo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Tentar novamente
          </button>
        </div>
      )}

      {concluida && auditoria && auditoria.motivosRevisao.length > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-warning-ink/40 bg-warning-bg p-4 text-sm text-warning-ink">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0">
            <p className="font-medium">Revisar manualmente: o sistema não afirma que esta empresa está habilitada.</p>
            <p className="mt-1 text-xs">Os documentos abaixo parecem em ordem, mas a leitura automática pode ter deixado exigências de fora. Confira o edital antes de decidir:</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-xs">
              {auditoria.motivosRevisao.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {concluida && auditoria && !auditoria.leituraCompleta && auditoria.arquivosComProblema.some((a) => a.principal) && (
        <div className="flex items-start gap-3 rounded-xl border border-warning-ink/30 bg-warning-bg p-4 text-sm text-warning-ink">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0">
            <p>Nem todos os documentos principais do processo (edital, termo de referência, preços) puderam ser lidos por inteiro, então este resultado não é definitivo. Veja abaixo quais ficaram sem leitura e confira-os manualmente: pode haver mais exigências neles.</p>
          </div>
        </div>
      )}

      {concluida && auditoria && <DocumentosAnalisados auditoria={auditoria} concluida />}

      {concluida && resumo.pendentes === 0 && (!auditoria || (auditoria.leituraCompleta && auditoria.motivosRevisao.length === 0)) && (
        <div className="flex items-start gap-3 rounded-xl border border-success-ink/30 bg-success-bg p-4 text-sm text-success-ink">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <p>Sem pendências: todos os documentos exigidos estão enviados e válidos na data da sessão.</p>
        </div>
      )}

      {avisoAnexo && (
        <div className="flex items-start gap-3 rounded-xl border border-success-ink/30 bg-success-bg p-4 text-sm text-success-ink">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{avisoAnexo}</p>
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
                <CartaoPendencia key={item.id} item={item} onAnexado={aoAnexar} />
              ))}
            </div>
          </section>
        ))}

      {concluida && relatorio.atendidas.length > 0 && (
        <details className="rounded-card bg-surface shadow-card">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-foreground">Documentos já atendidos ({relatorio.atendidas.length})</summary>
          <ul className="space-y-2 border-t border-border px-4 py-3 text-sm">
            {relatorio.atendidas.map((i) => (
              <li key={i.id} className="flex flex-wrap items-start justify-between gap-2">
                <span className="min-w-0 flex-1 text-foreground">
                  {i.documento}
                  {i.documentoEnviado && (
                    <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-success-bg px-2 py-0.5 text-[11px] font-medium text-success-ink" title={i.documentoEnviado.nome}>
                      <Check className="h-2.5 w-2.5" /> Enviado
                    </span>
                  )}
                </span>
                <span className="text-xs text-muted">
                  {i.localizacao ?? i.origem} · {i.validade ? `válido até ${new Date(i.validade).toLocaleDateString("pt-BR", { timeZone: "UTC" })}` : "não vence"}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {concluida && relatorio.naoSeAplicam.length > 0 && (
        <details className="rounded-card bg-surface shadow-card">
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
