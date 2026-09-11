"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Download, ExternalLink, Loader2, Paperclip, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, TextArea, TextInput } from "@/components/ui/Field";
import { formatDate, formatValorEdital } from "@/lib/format";
import { CORES_CARD, ETAPAS_KANBAN, topoCorCard } from "@/lib/kanban";
import type { CorCard, DocumentItem, EditalDetail, EtapaKanban } from "@/lib/types";

// Mesmo teto do upload de PDF/anexo no resto da plataforma.
const TAMANHO_MAXIMO_ANEXO = 3.5 * 1024 * 1024;

export function KanbanCardModal({
  editalId,
  onClose,
  onUpdated,
  onMoved,
  onDeleted,
}: {
  editalId: string;
  onClose: () => void;
  onUpdated: (partial: Partial<{ titulo: string; corCard: CorCard | null; notasInternas: string | null; etapaKanban: EtapaKanban; status: "NOVO" | "APROVADO" | "REPROVADO"; _count: { documents: number; checklistItems: number } }>) => void;
  onMoved: () => Promise<void>;
  onDeleted: (id: string) => void;
}) {
  const [edital, setEdital] = useState<EditalDetail | null>(null);
  const [titulo, setTitulo] = useState("");
  const [notas, setNotas] = useState("");
  const [salvandoCampo, setSalvandoCampo] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelado = false;
    fetch(`/api/editais/${editalId}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelado || !data.edital) return;
        setEdital(data.edital);
        setTitulo(data.edital.titulo);
        setNotas(data.edital.notasInternas ?? "");
      });
    return () => {
      cancelado = true;
    };
  }, [editalId]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function salvarCampo(campo: string, valor: unknown) {
    setSalvandoCampo(campo);
    try {
      const res = await fetch(`/api/editais/${editalId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [campo]: valor }),
      });
      if (res.ok) {
        const data = await res.json();
        setEdital((prev) => (prev ? { ...prev, ...data.edital } : prev));
        onUpdated({ [campo]: valor } as Partial<{ titulo: string; corCard: CorCard | null; notasInternas: string | null }>);
      }
    } finally {
      setSalvandoCampo(null);
    }
  }

  async function moverEtapa(etapaKanban: EtapaKanban) {
    if (!edital) return;
    setSalvandoCampo("etapaKanban");
    try {
      const res = await fetch(`/api/editais/${editalId}/kanban`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ etapaKanban, ordemKanban: Date.now() }),
      });
      if (res.ok) {
        const data = await res.json();
        setEdital((prev) => (prev ? { ...prev, ...data.edital } : prev));
        onUpdated({ etapaKanban, status: data.edital.status });
        await onMoved();
      }
    } finally {
      setSalvandoCampo(null);
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadError(null);
    if (file.size > TAMANHO_MAXIMO_ANEXO) {
      setUploadError(`Arquivo muito grande (máx. ${(TAMANHO_MAXIMO_ANEXO / 1024 / 1024).toFixed(1)}MB).`);
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
      const res = await fetch(`/api/editais/${editalId}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: file.name, arquivoBase64 }),
      });
      const data: { error?: string; document?: DocumentItem } = await res.json();
      if (!res.ok || !data.document) {
        setUploadError(data.error ?? "Não foi possível enviar o anexo.");
        return;
      }
      const novoDoc = data.document;
      setEdital((prev) => (prev ? { ...prev, documents: [...prev.documents, novoDoc] } : prev));
      onUpdated({
        _count: {
          documents: (edital?.documents.length ?? 0) + 1,
          checklistItems: edital?._count?.checklistItems ?? 0,
        },
      });
    } finally {
      setUploading(false);
    }
  }

  async function handleRemoverAnexo(docId: string) {
    const res = await fetch(`/api/editais/${editalId}/documents/${docId}`, { method: "DELETE" });
    if (res.ok) {
      setEdital((prev) => (prev ? { ...prev, documents: prev.documents.filter((d) => d.id !== docId) } : prev));
      onUpdated({
        _count: {
          documents: Math.max(0, (edital?.documents.length ?? 1) - 1),
          checklistItems: edital?._count?.checklistItems ?? 0,
        },
      });
    }
  }

  async function handleExcluir() {
    setExcluindo(true);
    try {
      const res = await fetch(`/api/editais/${editalId}`, { method: "DELETE" });
      if (res.ok) {
        onDeleted(editalId);
        onClose();
      }
    } finally {
      setExcluindo(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-foreground/40 px-4 py-10" onClick={onClose}>
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {!edital ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted" />
          </div>
        ) : (
          <>
            <div className={`h-1.5 w-full ${topoCorCard(edital.corCard)}`} />

            <div className="flex items-start justify-between gap-3 border-b border-border p-5">
              <TextInput
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                onBlur={() => {
                  if (titulo.trim() && titulo !== edital.titulo) salvarCampo("titulo", titulo.trim());
                }}
                className="mt-0 border-none px-0 text-base font-semibold focus:ring-0"
              />
              <button onClick={onClose} className="shrink-0 rounded-lg p-1.5 text-muted hover:bg-surface hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="max-h-[70vh] overflow-y-auto p-5">
              <p className="text-sm text-muted">
                {edital.orgaoNome} — {edital.municipio ?? "?"}/{edital.uf ?? "?"}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                <span className={`font-semibold ${edital.orcamentoSigiloso ? "italic text-muted" : "text-foreground"}`}>
                  {formatValorEdital(edital.valorGlobal, edital.orcamentoSigiloso)}
                </span>
                <span className="text-muted">Encerra {formatDate(edital.dataEncerramentoProposta)}</span>
                {edital.linkPortal && (
                  <a
                    href={edital.linkPortal}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-brand hover:underline"
                  >
                    Ver no PNCP <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>

              <div className="mt-4">
                <h4 className="text-sm font-medium text-foreground">Objeto</h4>
                <p className="mt-1 text-sm text-foreground/80">{edital.descricao}</p>
              </div>

              {edital.analysis?.resumoObjeto && (
                <p className="mt-3 rounded-lg bg-surface p-3 text-sm text-foreground/80">
                  <span className="font-medium text-brand">Análise do agente: </span>
                  {edital.analysis.resumoObjeto}
                </p>
              )}

              <div className="mt-5">
                <label className="block text-sm font-medium text-foreground">Etapa</label>
                <select
                  value={edital.etapaKanban}
                  onChange={(e) => moverEtapa(e.target.value as EtapaKanban)}
                  disabled={salvandoCampo === "etapaKanban"}
                  className="mt-1.5 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                >
                  {ETAPAS_KANBAN.map((et) => (
                    <option key={et.key} value={et.key}>
                      {et.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="mt-5">
                <label className="block text-sm font-medium text-foreground">Cor do card</label>
                <div className="mt-1.5 flex items-center gap-2">
                  <button
                    onClick={() => salvarCampo("corCard", null)}
                    className={`h-6 w-6 rounded-full border-2 border-dashed border-border ${!edital.corCard ? "ring-2 ring-brand ring-offset-2" : ""}`}
                    title="Sem cor"
                  />
                  {CORES_CARD.map((c) => (
                    <button
                      key={c.key}
                      onClick={() => salvarCampo("corCard", c.key)}
                      className={`h-6 w-6 rounded-full ${c.dot} ${edital.corCard === c.key ? "ring-2 ring-brand ring-offset-2" : ""}`}
                      title={c.label}
                    />
                  ))}
                </div>
              </div>

              <div className="mt-5">
                <Field label="Anotações" htmlFor="notasInternas">
                  <TextArea
                    id="notasInternas"
                    rows={3}
                    value={notas}
                    onChange={(e) => setNotas(e.target.value)}
                    onBlur={() => {
                      if (notas !== (edital.notasInternas ?? "")) salvarCampo("notasInternas", notas || null);
                    }}
                    placeholder="Observações internas sobre este edital..."
                  />
                </Field>
              </div>

              <div className="mt-5">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-foreground">Anexos</label>
                  <Button variant="secondary" onClick={() => fileInputRef.current?.click()} loading={uploading}>
                    {!uploading && <Paperclip className="h-3.5 w-3.5" />}
                    Adicionar
                  </Button>
                  <input ref={fileInputRef} type="file" className="hidden" onChange={handleUpload} />
                </div>
                {uploadError && <p className="mt-1.5 text-xs text-danger">{uploadError}</p>}
                <div className="mt-2 space-y-1.5">
                  {edital.documents.length === 0 && <p className="text-xs text-muted">Nenhum anexo ainda.</p>}
                  {edital.documents.map((doc) => (
                    <div
                      key={doc.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-xs"
                    >
                      <a
                        href={`/api/editais/${editalId}/documents/${doc.id}/download`}
                        target="_blank"
                        rel="noreferrer"
                        className="flex min-w-0 items-center gap-1.5 text-foreground hover:text-brand"
                      >
                        <Download className="h-3 w-3 shrink-0" />
                        <span className="truncate">{doc.nome}</span>
                      </a>
                      {doc.tipo === "DOCUMENTO_USUARIO" && (
                        <button
                          onClick={() => handleRemoverAnexo(doc.id)}
                          className="shrink-0 text-muted hover:text-danger"
                          title="Remover anexo"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-border p-4">
              <Link
                href={`/editais/${editalId}`}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline"
              >
                Abrir detalhes completos (análise, proposta, checklist) →
              </Link>

              {!confirmandoExclusao ? (
                <button
                  onClick={() => setConfirmandoExclusao(true)}
                  className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-muted hover:text-danger"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Excluir card
                </button>
              ) : (
                <div className="flex shrink-0 items-center gap-2 text-xs">
                  <span
                    className="inline-flex items-center gap-1 text-danger"
                    title="Apaga também análise, proposta, anexos, checklist e histórico deste edital — não dá pra desfazer."
                  >
                    <AlertTriangle className="h-3.5 w-3.5" /> Excluir de vez?
                  </span>
                  <button
                    onClick={() => setConfirmandoExclusao(false)}
                    className="rounded-lg border border-border px-2.5 py-1.5 font-medium text-foreground hover:bg-surface"
                  >
                    Cancelar
                  </button>
                  <Button variant="danger" onClick={handleExcluir} loading={excluindo} className="px-2.5 py-1.5 text-xs">
                    Confirmar exclusão
                  </Button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
