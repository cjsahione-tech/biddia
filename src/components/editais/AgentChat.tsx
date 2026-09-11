"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, Loader2, Paperclip, Send, User } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { formatDateTime } from "@/lib/format";
import type { AgentMessageItem } from "@/lib/types";

const TAMANHO_MAXIMO_ANEXO = 3.5 * 1024 * 1024;

export function AgentChat({
  editalId,
  agentKey,
  agentLabel,
  onCorrected,
}: {
  editalId: string;
  agentKey: string;
  agentLabel: string;
  onCorrected: () => void;
}) {
  const [messages, setMessages] = useState<AgentMessageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [texto, setTexto] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelado = false;
    fetch(`/api/editais/${editalId}/agent-chat?agente=${agentKey}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelado && data.messages) setMessages(data.messages);
      })
      .finally(() => {
        if (!cancelado) setLoading(false);
      });
    return () => {
      cancelado = true;
    };
  }, [editalId, agentKey]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setErro(null);
    if (file.size > TAMANHO_MAXIMO_ANEXO) {
      setErro(`Anexo muito grande (máx. ${(TAMANHO_MAXIMO_ANEXO / 1024 / 1024).toFixed(1)}MB).`);
      return;
    }
    setArquivo(file);
  }

  async function enviar() {
    const mensagem = texto.trim();
    if (!mensagem || enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      let anexoBase64: string | undefined;
      if (arquivo) {
        anexoBase64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(arquivo);
        });
      }

      const res = await fetch(`/api/editais/${editalId}/agent-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentKey, mensagem, anexoNome: arquivo?.name, anexoBase64 }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErro(data.error ?? "Não foi possível enviar a mensagem.");
        return;
      }
      setMessages((prev) => [...prev, data.userMessage, data.agentMessage]);
      setTexto("");
      setArquivo(null);
      onCorrected();
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-surface/30">
      <div className="border-b border-border px-4 py-3">
        <h4 className="text-sm font-semibold text-foreground">Converse com o {agentLabel}</h4>
        <p className="mt-0.5 text-xs text-muted">
          Encontrou um erro no que o agente fez? Explique aqui (pode anexar um documento) e ele corrige.
        </p>
      </div>

      <div ref={listRef} className="max-h-72 space-y-3 overflow-y-auto px-4 py-3">
        {loading && (
          <div className="flex justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted" />
          </div>
        )}
        {!loading && messages.length === 0 && (
          <p className="py-2 text-center text-xs text-muted">Nenhuma conversa ainda.</p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`flex gap-2 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            {m.role === "agent" && (
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-light text-brand">
                <Bot className="h-3.5 w-3.5" />
              </div>
            )}
            <div
              className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${
                m.role === "user" ? "bg-brand text-white" : "border border-border bg-background text-foreground"
              }`}
            >
              <p className="whitespace-pre-wrap">{m.conteudo}</p>
              {m.anexoNome && (
                <a
                  href={m.anexoDocId ? `/api/editais/${editalId}/documents/${m.anexoDocId}/download` : undefined}
                  target="_blank"
                  rel="noreferrer"
                  className={`mt-1.5 inline-flex items-center gap-1 text-xs ${
                    m.role === "user" ? "text-white/80 hover:text-white" : "text-brand hover:underline"
                  }`}
                >
                  <Paperclip className="h-3 w-3" /> {m.anexoNome}
                </a>
              )}
              <p className={`mt-1 text-[10px] ${m.role === "user" ? "text-white/60" : "text-muted"}`}>
                {formatDateTime(m.createdAt)}
              </p>
            </div>
            {m.role === "user" && (
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface text-muted">
                <User className="h-3.5 w-3.5" />
              </div>
            )}
          </div>
        ))}
        {enviando && (
          <div className="flex items-center gap-2 text-xs text-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> {agentLabel} está corrigindo...
          </div>
        )}
      </div>

      <div className="border-t border-border p-3">
        {erro && <p className="mb-2 text-xs text-danger">{erro}</p>}
        {arquivo && (
          <div className="mb-2 flex items-center justify-between rounded-lg bg-surface px-2.5 py-1.5 text-xs text-foreground">
            <span className="inline-flex min-w-0 items-center gap-1 truncate">
              <Paperclip className="h-3 w-3 shrink-0" /> {arquivo.name}
            </span>
            <button onClick={() => setArquivo(null)} className="shrink-0 text-muted hover:text-danger">
              Remover
            </button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <input ref={fileInputRef} type="file" className="hidden" onChange={handleFile} />
          <button
            onClick={() => fileInputRef.current?.click()}
            title="Anexar documento"
            disabled={enviando}
            className="shrink-0 rounded-lg border border-border p-2 text-muted hover:bg-surface hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Paperclip className="h-4 w-4" />
          </button>
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                enviar();
              }
            }}
            rows={1}
            disabled={enviando}
            placeholder={`Descreva o que o ${agentLabel} errou...`}
            className="max-h-32 flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
          />
          <Button onClick={enviar} loading={enviando} disabled={!texto.trim()} className="shrink-0 px-3">
            {!enviando && <Send className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}
