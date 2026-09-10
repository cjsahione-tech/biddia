"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Search,
  Loader2,
  ThumbsUp,
  ThumbsDown,
  ExternalLink,
  RefreshCw,
  AlertTriangle,
  Download,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { formatValorEdital, formatDate } from "@/lib/format";
import { empresaAtende } from "@/lib/agents/classificador-objeto";
import type { EditalListItem } from "@/lib/types";

// Limite prático de tamanho do PDF enviado manualmente: o corpo da requisição vai em
// base64 (~33% maior que o arquivo original) e a Vercel tem um teto fixo de ~4,5MB por
// requisição em Serverless Functions — não dá para configurar isso, então avisamos
// antes de tentar enviar.
const TAMANHO_MAXIMO_PDF = 3.5 * 1024 * 1024;

const TIPO_OBJETO_LABEL: Record<"SERVICO" | "BEM", string> = {
  SERVICO: "Serviço",
  BEM: "Bem/Insumo",
};

const TABS = [
  { key: "NOVO", label: "Novos" },
  { key: "APROVADO", label: "Aprovados" },
  { key: "REPROVADO", label: "Reprovados" },
] as const;

export function DashboardClient() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [editais, setEditais] = useState<EditalListItem[]>([]);
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("NOVO");
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [searchMsg, setSearchMsg] = useState<string | null>(null);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [perfil, setPerfil] = useState({ atendeServico: true, atendeBem: true });
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

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
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- busca inicial ao montar a tela
    load();
  }, [load]);

  async function handleSearch() {
    setSearching(true);
    setSearchMsg(null);
    try {
      const res = await fetch("/api/editais/search", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setSearchMsg(data.error ?? "Erro ao buscar editais");
        return;
      }
      setSearchMsg(data.mensagem);
      await load();
    } finally {
      setSearching(false);
    }
  }

  async function handleDecision(id: string, decision: "APROVADO" | "REPROVADO") {
    setDecidingId(id);
    try {
      await fetch(`/api/editais/${id}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      await load();
      if (decision === "APROVADO") setTab("APROVADO");
    } finally {
      setDecidingId(null);
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
        `PDF muito grande (${(file.size / 1024 / 1024).toFixed(1)}MB). O limite é de ${(TAMANHO_MAXIMO_PDF / 1024 / 1024).toFixed(1)}MB.`
      );
      return;
    }

    const arquivoBase64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });

    setUploading(true);
    try {
      const res = await fetch("/api/editais/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nomeArquivo: file.name, arquivoBase64 }),
      });
      const data = await res.json();
      if (!res.ok) {
        setUploadError(data.error ?? "Não foi possível processar o PDF enviado.");
        return;
      }
      // O edital já entra aprovado e com o pipeline disparado — manda direto para o
      // detalhe, onde o progresso dos agentes aparece em tempo real.
      router.push(`/editais/${data.edital.id}`);
    } finally {
      setUploading(false);
    }
  }

  const filtered = editais.filter((e) => e.status === tab);

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Editais</h1>
          <p className="mt-1 text-sm text-muted">
            O Agente Comercial busca editais no PNCP com base nas suas palavras-chave.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
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
        resto — leitura, análise, proposta, anexos e checklist, automaticamente.
      </p>

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

      <div className="mt-8 flex items-center gap-1 border-b border-border">
        {TABS.map((t) => {
          const count = editais.filter((e) => e.status === t.key).length;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`relative -mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition ${
                tab === t.key
                  ? "border-brand text-brand"
                  : "border-transparent text-muted hover:text-foreground"
              }`}
            >
              {t.label}
              <span
                className={`rounded-full px-1.5 py-0.5 text-xs ${
                  tab === t.key ? "bg-brand-light text-brand" : "bg-surface text-muted"
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-6 space-y-4">
        {loading && (
          <div className="flex items-center justify-center py-16 text-muted">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border py-16 text-center">
            <p className="text-sm text-muted">
              {tab === "NOVO"
                ? "Nenhum edital novo por aqui. Clique em “Buscar novos editais” para o Agente Comercial procurar no PNCP."
                : "Nenhum edital nesta categoria ainda."}
            </p>
          </div>
        )}

        {filtered.map((edital) => {
          const foraDoPerfil = edital.tipoObjeto ? !empresaAtende(edital.tipoObjeto, perfil) : false;
          return (
          <div
            key={edital.id}
            className={`rounded-2xl border bg-background p-5 shadow-sm transition hover:shadow-md ${
              foraDoPerfil ? "border-warning/40" : "border-border"
            }`}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-brand-light px-2.5 py-0.5 text-xs font-medium text-brand">
                    {edital.modalidade ?? "Modalidade não informada"}
                  </span>
                  {edital.fonte === "MANUAL" && (
                    <span className="rounded-full bg-surface px-2.5 py-0.5 text-xs font-medium text-muted">
                      Adicionado manualmente
                    </span>
                  )}
                  {edital.tipoObjeto && (
                    <span className="rounded-full bg-surface px-2.5 py-0.5 text-xs font-medium text-muted">
                      {TIPO_OBJETO_LABEL[edital.tipoObjeto]}
                    </span>
                  )}
                  {foraDoPerfil && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2.5 py-0.5 text-xs font-medium text-warning">
                      <AlertTriangle className="h-3 w-3" /> Fora do seu perfil
                    </span>
                  )}
                  {edital.keywordMatched && (
                    <span className="text-xs text-muted">via &ldquo;{edital.keywordMatched}&rdquo;</span>
                  )}
                </div>
                <h3 className="mt-2 truncate text-base font-semibold text-foreground">
                  {edital.titulo}
                </h3>
                <p className="mt-1 text-sm text-muted">
                  {edital.orgaoNome} — {edital.municipio ?? "?"}/{edital.uf ?? "?"}
                </p>
                <p className="mt-2 line-clamp-2 text-sm text-foreground/80">{edital.descricao}</p>
                {edital.analysis?.resumoObjeto && (
                  <p className="mt-2 text-sm text-foreground/80">
                    <span className="font-medium text-brand">Análise do agente: </span>
                    {edital.analysis.resumoObjeto}
                  </p>
                )}
              </div>
              <div className="shrink-0 text-right">
                <p
                  className={`text-sm font-semibold ${edital.orcamentoSigiloso ? "text-muted italic" : "text-foreground"}`}
                >
                  {formatValorEdital(edital.valorGlobal, edital.orcamentoSigiloso)}
                </p>
                <p className="mt-1 text-xs text-muted">
                  Encerra {formatDate(edital.dataEncerramentoProposta)}
                </p>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                {edital.linkPortal && (
                  <a
                    href={edital.linkPortal}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-muted hover:text-brand"
                  >
                    Ver no PNCP <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                {edital.documents.map((doc) => (
                  <a
                    key={doc.id}
                    href={`/api/editais/${edital.id}/documents/${doc.id}/download`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-brand hover:underline"
                  >
                    <Download className="h-3 w-3" />
                    {doc.categoria === "TERMO_REFERENCIA" ? "Baixar termo de referência" : "Baixar edital"}
                  </a>
                ))}
              </div>

              <div className="flex items-center gap-2">
                {edital.status === "NOVO" && (
                  <>
                    <Button
                      variant="secondary"
                      onClick={() => handleDecision(edital.id, "REPROVADO")}
                      loading={decidingId === edital.id}
                    >
                      <ThumbsDown className="h-3.5 w-3.5" /> Reprovar
                    </Button>
                    <Button
                      onClick={() => handleDecision(edital.id, "APROVADO")}
                      loading={decidingId === edital.id}
                    >
                      <ThumbsUp className="h-3.5 w-3.5" /> Aprovar
                    </Button>
                  </>
                )}
                {edital.status !== "NOVO" && (
                  <Link
                    href={`/editais/${edital.id}`}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-surface"
                  >
                    Abrir detalhes
                  </Link>
                )}
              </div>
            </div>
          </div>
          );
        })}
      </div>

      {!loading && (
        <button
          onClick={load}
          className="mt-8 inline-flex items-center gap-1.5 text-xs text-muted hover:text-foreground"
        >
          <RefreshCw className="h-3 w-3" /> Atualizar lista
        </button>
      )}
    </div>
  );
}
