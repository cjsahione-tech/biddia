"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Search, Loader2, RefreshCw, Upload, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { KanbanBoard } from "@/components/dashboard/KanbanBoard";
import type { EditalListItem } from "@/lib/types";

type StatusLimite = { atual: number; limite: number | null; excedido: boolean };

// O arquivo sobe direto pro Supabase Storage via URL assinada (nunca passa pelo corpo
// da nossa função serverless, que tem um teto físico de ~4,5MB na Vercel) — o teto real
// aqui é só pra cobrir editais consolidados (edital + Termo de Referência + anexos num
// único PDF) sem exagerar no custo de armazenamento/extração de texto.
const TAMANHO_MAXIMO_PDF = 50 * 1024 * 1024;

export function DashboardClient() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [editais, setEditais] = useState<EditalListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [searchMsg, setSearchMsg] = useState<string | null>(null);
  const [perfil, setPerfil] = useState({ atendeServico: true, atendeBem: true });
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [limite, setLimite] = useState<{ editaisAtivos: StatusLimite; analisesNoMes: StatusLimite } | null>(null);

  const load = useCallback(async () => {
    const [editaisRes, companyRes] = await Promise.all([fetch("/api/editais"), fetch("/api/company")]);
    const data = await editaisRes.json();
    const companyData = await companyRes.json();
    setEditais(data.editais ?? []);
    if (companyData.company) {
      setPerfil({
        atendeServico: companyData.company.atendeServico,
        atendeBem: companyData.company.atendeBem,
      });
    }
    setLoading(false);
    // Nunca bloqueia — só informa, sem travar o carregamento do quadro se falhar.
    fetch("/api/plano/limite")
      .then((r) => r.json())
      .then((d) => d.editaisAtivos && setLimite(d))
      .catch(() => {});
  }, []);

  // Recarrega SÓ a lista de editais, sem piscar a tela de carregamento — e só troca o estado
  // se algo mudou de verdade (evita re-render do quadro inteiro a cada ciclo de polling).
  const assinaturaRef = useRef("");
  const atualizarEditais = useCallback(async () => {
    try {
      const res = await fetch("/api/editais");
      if (!res.ok) return;
      const data = await res.json();
      const lista: EditalListItem[] = data.editais ?? [];
      const assinatura = lista
        .map((e) => `${e.id}|${e.etapaKanban}|${e.ordemKanban}|${e.status}|${e.visualizado}|${e.corCard}|${e.motivoMovimentacao}`)
        .join(",");
      if (assinatura === assinaturaRef.current) return;
      assinaturaRef.current = assinatura;
      setEditais(lista);
    } catch {
      // falha de rede passageira: tenta de novo no próximo ciclo
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- busca inicial ao montar a tela
    load();
  }, [load]);

  // Acompanha a busca do Agente Comercial (roda em segundo plano no servidor): a cada
  // poucos segundos pergunta o estado e recarrega o quadro, então os cards novos aparecem
  // sozinhos conforme são criados — sem precisar recarregar a página.
  const buscaPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [progressoBusca, setProgressoBusca] = useState<{ fase: string; novos: number; analisados: number } | null>(null);

  const pararAcompanhamentoBusca = useCallback(() => {
    if (buscaPollRef.current) clearInterval(buscaPollRef.current);
    buscaPollRef.current = null;
  }, []);

  const acompanharBusca = useCallback(() => {
    if (buscaPollRef.current) return;
    setSearching(true);
    buscaPollRef.current = setInterval(async () => {
      try {
        const res = await fetch("/api/editais/search");
        const data = await res.json();
        const run = data.run;
        await atualizarEditais();
        if (!run || run.status === "RUNNING") {
          if (run) setProgressoBusca({ fase: run.fase, novos: run.novos, analisados: run.analisados });
          return;
        }
        pararAcompanhamentoBusca();
        setProgressoBusca(null);
        setSearching(false);
        setSearchMsg(run.mensagem ?? (run.status === "ERROR" ? "Erro ao buscar editais" : null));
        load();
      } catch {
        // falha de rede passageira: continua tentando enquanto a busca estiver ativa
      }
    }, 2500);
  }, [atualizarEditais, load, pararAcompanhamentoBusca]);

  useEffect(() => () => pararAcompanhamentoBusca(), [pararAcompanhamentoBusca]);

  // Retoma o acompanhamento se o usuário recarregou a página no meio de uma busca.
  useEffect(() => {
    let cancelado = false;
    fetch("/api/editais/search")
      .then((r) => r.json())
      .then((d) => {
        if (!cancelado && d.run?.status === "RUNNING") acompanharBusca();
      })
      .catch(() => {});
    return () => {
      cancelado = true;
    };
  }, [acompanharBusca]);

  // Atualização automática leve: a cada 30s (só com a aba visível) busca editais novos —
  // cobre os que chegam pela busca agendada (8:30/15:30) ou por outro dispositivo.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible" && !buscaPollRef.current) atualizarEditais();
    }, 30_000);
    const aoVoltar = () => {
      if (document.visibilityState === "visible") atualizarEditais();
    };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", aoVoltar);
    };
  }, [atualizarEditais]);

  async function handleSearch() {
    setSearching(true);
    setSearchMsg(null);
    setProgressoBusca({ fase: "buscando", novos: 0, analisados: 0 });
    try {
      const res = await fetch("/api/editais/search", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setSearchMsg(data?.error ?? "Erro ao buscar editais");
        setSearching(false);
        setProgressoBusca(null);
        return;
      }
      acompanharBusca();
    } catch {
      setSearchMsg("Não foi possível iniciar a busca — verifique sua conexão e tente de novo.");
      setSearching(false);
      setProgressoBusca(null);
    }
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // permite selecionar o mesmo arquivo de novo depois de um erro
    if (!file) return;

    setUploadError(null);

    if (file.type !== "application/pdf") {
      setUploadError("Envie um arquivo em PDF.");
      return;
    }
    if (file.size > TAMANHO_MAXIMO_PDF) {
      setUploadError(
        `PDF muito grande (${(file.size / 1024 / 1024).toFixed(1)}MB). O limite é de ${(TAMANHO_MAXIMO_PDF / 1024 / 1024).toFixed(0)}MB.`
      );
      return;
    }

    setUploading(true);
    try {
      // Sobe direto pro Storage via URL assinada — o PDF nunca passa pelo corpo da
      // nossa função serverless, então cabe um edital consolidado grande (edital + TR +
      // anexos no mesmo arquivo) sem esbarrar no teto de corpo de requisição da Vercel.
      const urlRes = await fetch("/api/editais/manual/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nomeArquivo: file.name, tamanhoBytes: file.size }),
      });
      const urlData = await urlRes.json().catch(() => null);
      if (!urlRes.ok) {
        setUploadError(urlData?.error ?? "Não foi possível preparar o upload.");
        return;
      }

      const putRes = await fetch(urlData.signedUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/pdf" },
        body: file,
      });
      if (!putRes.ok) {
        setUploadError("Falha no upload para o armazenamento. Tente novamente.");
        return;
      }

      const res = await fetch("/api/editais/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nomeArquivo: file.name, storagePath: urlData.path }),
      });
      const data = await res.json();
      if (!res.ok) {
        setUploadError(data.error ?? "Não foi possível processar o PDF enviado.");
        return;
      }
      // O edital já entra em "Rascunho" e com o pipeline disparado — manda direto para
      // o detalhe, onde o progresso dos agentes aparece em tempo real.
      router.push(`/editais/${data.edital.id}`);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Editais</h1>
          <p className="mt-1 text-sm text-muted">
            Arraste os cards entre as colunas para acompanhar o andamento de cada licitação.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => fileInputRef.current?.click()} loading={uploading}>
            {!uploading && <Upload className="h-4 w-4" />}
            Adicionar PDF
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={handleFileSelected}
          />
          <Button onClick={handleSearch} loading={searching}>
            {!searching && <Search className="h-4 w-4" />}
            Buscar novos editais
          </Button>
        </div>
      </div>

      <p className="mt-2 text-xs text-muted">
        Já encontrou um edital em outro lugar? Envie o PDF em &ldquo;Adicionar PDF&rdquo; e os agentes cuidam do
        resto — leitura, análise, proposta, anexos e checklist, automaticamente. Editais buscados pelo Agente
        Comercial entram em &ldquo;Oportunidade&rdquo;; arraste para fora de lá quando decidir participar.
      </p>

      {(limite?.editaisAtivos.excedido || limite?.analisesNoMes.excedido) && (
        <p className="mt-4 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 px-4 py-2.5 text-sm text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {limite.editaisAtivos.excedido &&
              `Você tem ${limite.editaisAtivos.atual} editais ativos, acima do limite de ${limite.editaisAtivos.limite} do seu plano. `}
            {limite.analisesNoMes.excedido &&
              `Já rodaram ${limite.analisesNoMes.atual} análises este mês, acima do limite de ${limite.analisesNoMes.limite} do seu plano. `}
            Nada foi bloqueado — considere um upgrade de plano pra continuar dentro do previsto.
          </span>
        </p>
      )}

      {searching && progressoBusca && (
        <p className="mt-4 flex items-center gap-2 rounded-lg border border-brand/20 bg-brand-light/40 px-4 py-2.5 text-sm text-foreground">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-brand" />
          <span>
            {progressoBusca.fase === "buscando" && "Buscando nos portais (PNCP, LicitaNet…) — você pode continuar usando o sistema, os cards aparecem sozinhos."}
            {progressoBusca.fase === "classificando" &&
              `${progressoBusca.analisados} oportunidade(s) encontrada(s) — avaliando quais combinam com a sua empresa…`}
            {progressoBusca.fase === "criando" &&
              `${progressoBusca.novos} edital(is) novo(s) já adicionado(s) ao quadro — finalizando a busca…`}
          </span>
        </p>
      )}

      {searchMsg && (
        <p className="mt-4 rounded-lg border border-border bg-surface px-4 py-2.5 text-sm text-foreground">
          {searchMsg}
        </p>
      )}

      {uploadError && (
        <p className="mt-4 rounded-lg border border-danger/30 bg-danger/5 px-4 py-2.5 text-sm text-danger">
          {uploadError}
        </p>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-24 text-muted">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        <KanbanBoard editais={editais} setEditais={setEditais} perfil={perfil} onReload={load} />
      )}

      {!loading && (
        <button
          onClick={load}
          className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted hover:text-foreground"
        >
          <RefreshCw className="h-3 w-3" /> Atualizar quadro
        </button>
      )}
    </div>
  );
}
