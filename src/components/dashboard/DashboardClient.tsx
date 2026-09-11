"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Search, Loader2, RefreshCw, Upload } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { KanbanBoard } from "@/components/dashboard/KanbanBoard";
import type { EditalListItem } from "@/lib/types";

// Limite prático de tamanho do PDF enviado manualmente: o corpo da requisição vai em
// base64 (~33% maior que o arquivo original) e a Vercel tem um teto fixo de ~4,5MB por
// requisição em Serverless Functions — não dá para configurar isso, então avisamos
// antes de tentar enviar.
const TAMANHO_MAXIMO_PDF = 3.5 * 1024 * 1024;

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
      // O edital já entra em "Rascunho" e com o pipeline disparado — manda direto para
      // o detalhe, onde o progresso dos agentes aparece em tempo real.
      router.push(`/editais/${data.edital.id}`);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="mx-auto max-w-[1400px] px-8 py-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Editais</h1>
          <p className="mt-1 text-sm text-muted">
            Arraste os cards entre as colunas para acompanhar o andamento de cada licitação.
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
        resto — leitura, análise, proposta, anexos e checklist, automaticamente. Editais buscados pelo Agente
        Comercial entram em &ldquo;Oportunidade&rdquo;; arraste para fora de lá quando decidir participar.
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
