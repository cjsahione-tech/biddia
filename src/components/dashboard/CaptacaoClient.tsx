"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, Plus, Search, X } from "lucide-react";
import { FONTES_ATIVAS, fonteAtiva } from "@/lib/fontes-captacao";
import { PaginaConteudo } from "@/components/ui/PaginaConteudo";

type Run = { status: "RUNNING" | "DONE" | "ERROR"; fase: string; novos: number; analisados: number; mensagem: string | null; startedAt: string } | null;
type Palavra = { id: string; term: string };

function Fonte({ nome, descricao, ativa, detalhe }: { nome: string; descricao: string; ativa: boolean; detalhe?: string }) {
  return (
    <div className="flex items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-foreground">{nome}</p>
        <p className="truncate text-xs text-muted">{detalhe ?? descricao}</p>
      </div>
      <span className={`flex-none rounded-chip px-2.5 py-1 text-[11px] font-bold ${ativa ? "bg-success-bg text-success-ink" : "bg-neutral-bg text-muted"}`}>
        {ativa ? "Ativa" : "Inativa"}
      </span>
    </div>
  );
}

/**
 * Tela Captação (celular e computador): fontes de editais, palavras-chave da empresa, resultado da última busca e o botão
 * "Captar agora". Reúne o que antes ficava espalhado entre o quadro de editais e a tela Empresa — usando as mesmas APIs.
 */
export function CaptacaoClient() {
  const [palavras, setPalavras] = useState<Palavra[] | null>(null);
  const [segmento, setSegmento] = useState<string | null>(null);
  const [comprasGov, setComprasGov] = useState(false);
  const [run, setRun] = useState<Run>(null);
  const [novaPalavra, setNovaPalavra] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [iniciando, setIniciando] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const carregarRun = useCallback(async () => {
    const d = await fetch("/api/editais/search").then((r) => r.json()).catch(() => null);
    setRun(d?.run ?? null);
    return d?.run as Run;
  }, []);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      const [k, c, p] = await Promise.all([
        fetch("/api/keywords").then((r) => r.json()).catch(() => null),
        fetch("/api/company").then((r) => r.json()).catch(() => null),
        fetch("/api/plano/resumo").then((r) => r.json()).catch(() => null),
      ]);
      if (cancelado) return;
      setPalavras(k?.keywords ?? []);
      setSegmento(c?.company?.licitanetSegmentoNome ?? null);
      setComprasGov((p?.funcoes ?? []).some((f: { label: string }) => /compras\.?gov/i.test(f.label)));
      await carregarRun();
    })();
    return () => {
      cancelado = true;
    };
  }, [carregarRun]);

  const acompanhar = useCallback(() => {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      const r = await carregarRun();
      if (!r || r.status !== "RUNNING") {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }, 3000);
  }, [carregarRun]);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);
  useEffect(() => {
    if (run?.status === "RUNNING") acompanhar();
  }, [run?.status, acompanhar]);

  async function captarAgora() {
    setIniciando(true);
    setErro(null);
    try {
      const res = await fetch("/api/editais/search", { method: "POST" });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        setErro(d?.error ?? "Não foi possível iniciar a captação.");
        return;
      }
      await carregarRun();
      acompanhar();
    } finally {
      setIniciando(false);
    }
  }

  async function adicionar() {
    const term = novaPalavra.trim();
    if (term.length < 2) return;
    setErro(null);
    const res = await fetch("/api/keywords", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ term }) });
    const d = await res.json().catch(() => null);
    if (!res.ok) {
      setErro(d?.error ?? "Não foi possível adicionar.");
      return;
    }
    setPalavras((p) => [...(p ?? []), d.keyword]);
    setNovaPalavra("");
  }

  async function remover(id: string) {
    await fetch(`/api/keywords?id=${id}`, { method: "DELETE" });
    setPalavras((p) => (p ?? []).filter((k) => k.id !== id));
  }

  const rodando = run?.status === "RUNNING";
  const quando = run ? new Date(run.startedAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : null;

  return (
    <PaginaConteudo titulo="Captação" subtitulo="Fontes e palavras-chave">

      {!palavras ? (
        <div className="flex justify-center py-16 text-muted">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        <div className="mt-4 space-y-3 md:max-w-xl">
          <div className="rounded-card bg-surface px-4 py-2">
            <p className="pt-2 text-[15px] font-bold text-foreground">Fontes de editais</p>
            <div className="divide-y divide-border">
              <Fonte nome="PNCP" descricao="Portal Nacional de Contratações Públicas" ativa={palavras.length > 0} detalhe={palavras.length > 0 ? "Busca pelas palavras-chave da empresa" : "Cadastre palavras-chave para ativar"} />
              {fonteAtiva("LICITANET") && (
                <Fonte nome="LicitaNet" descricao="Captação automática" ativa={!!segmento} detalhe={segmento ? `Segmento: ${segmento}` : "Escolha o segmento em Empresa para ativar"} />
              )}
              {fonteAtiva("COMPRASGOV") && (
                <Fonte nome="Compras.gov.br" descricao="Captação automática" ativa={comprasGov} detalhe={comprasGov ? "Captação automática" : "Não incluída no plano atual"} />
              )}
            </div>
            {FONTES_ATIVAS.length === 1 && <p className="pb-3 text-xs text-muted">Captação disponível apenas no PNCP.</p>}
          </div>

          <div className="rounded-card bg-surface p-4">
            <p className="text-[15px] font-bold text-foreground">Palavras-chave da empresa</p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {palavras.map((k) => (
                <span key={k.id} className="inline-flex items-center gap-1.5 rounded-chip bg-brand-light px-2.5 py-1 text-[12px] font-bold text-tint-ink">
                  {k.term}
                  <button onClick={() => remover(k.id)} aria-label={`Remover ${k.term}`}>
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              {palavras.length === 0 && <p className="text-xs text-muted">Nenhuma palavra-chave cadastrada ainda.</p>}
            </div>
            <div className="mt-3 flex gap-2">
              <input
                value={novaPalavra}
                onChange={(e) => setNovaPalavra(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && adicionar()}
                placeholder="Nova palavra-chave"
                className="h-10 min-w-0 flex-1 rounded-card bg-background px-4 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30"
              />
              <button onClick={adicionar} aria-label="Adicionar palavra-chave" className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-brand text-on-brand">
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="rounded-card bg-surface p-4">
            <p className="text-[15px] font-bold text-foreground">Última captação</p>
            {run ? (
              <>
                <p className="mt-0.5 text-xs text-muted">{rodando ? "Em andamento agora…" : quando}</p>
                <div className="mt-3 flex gap-2">
                  <div className="flex-1 rounded-2xl bg-background p-3">
                    <p className="font-[family-name:var(--font-rubik)] text-xl font-semibold text-foreground">{run.novos}</p>
                    <p className="text-[11px] text-muted">editais novos</p>
                  </div>
                  <div className="flex-1 rounded-2xl bg-background p-3">
                    <p className="font-[family-name:var(--font-rubik)] text-xl font-semibold text-foreground">{run.analisados}</p>
                    <p className="text-[11px] text-muted">encontrados</p>
                  </div>
                </div>
                {run.mensagem && !rodando && <p className="mt-2.5 text-xs text-muted">{run.mensagem}</p>}
              </>
            ) : (
              <p className="mt-1 text-xs text-muted">Ainda não houve nenhuma captação.</p>
            )}
          </div>

          {erro && <p className="text-xs text-danger-ink">{erro}</p>}
          <button
            onClick={captarAgora}
            disabled={iniciando || rodando}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-pill bg-accent text-sm font-bold text-on-accent hover:brightness-95 disabled:opacity-70"
          >
            {iniciando || rodando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            {rodando ? "Captando…" : "Captar agora"}
          </button>
          <Link href="/editais?etapa=RASCUNHO" className="block rounded-card bg-surface py-3.5 text-center text-sm font-bold text-brand">
            Ver editais descartados →
          </Link>
        </div>
      )}
    </PaginaConteudo>
  );
}
