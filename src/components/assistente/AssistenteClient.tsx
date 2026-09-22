"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, Download, Loader2, Send, Sparkles, User } from "lucide-react";
import { Button } from "@/components/ui/Button";

type Arquivo = { nome: string; contentType: string; base64: string };
type Mensagem = { role: "user" | "assistant"; content: string; arquivos?: Arquivo[] };

const SUGESTOES = [
  "Quantos editais eu tenho em Qualificação?",
  "Qual o prazo de encerramento mais próximo?",
  "Gere o PDF do Dashboard de Resultados",
  "O que você pode fazer por mim?",
];

export function AssistenteClient() {
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [mensagens]);

  async function enviarMensagem(conteudo: string) {
    const mensagem = conteudo.trim();
    if (!mensagem || enviando) return;

    const novoHistorico: Mensagem[] = [...mensagens, { role: "user", content: mensagem }];
    setMensagens(novoHistorico);
    setTexto("");
    setEnviando(true);
    setErro(null);

    try {
      const res = await fetch("/api/assistente", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mensagens: novoHistorico.map((m) => ({ role: m.role, content: m.content })) }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErro(data.error ?? "Não foi possível responder agora.");
        setMensagens((prev) => prev.slice(0, -1)); // desfaz a mensagem do usuário — ela pode reenviar
        return;
      }
      setMensagens((prev) => [...prev, { role: "assistant", content: data.resposta, arquivos: data.arquivos }]);
    } finally {
      setEnviando(false);
    }
  }

  function baixarArquivo(arquivo: Arquivo) {
    const link = document.createElement("a");
    link.href = `data:${arquivo.contentType};base64,${arquivo.base64}`;
    link.download = arquivo.nome;
    link.click();
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-2rem)] max-w-3xl flex-col px-8 py-6">
      <div className="flex items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-light text-brand">
          <Sparkles className="h-4.5 w-4.5" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-foreground">Bidd.IA</h1>
          <p className="text-xs text-muted">Pergunte sobre qualquer processo ou peça pra gerar um arquivo.</p>
        </div>
      </div>

      <div ref={listRef} className="mt-4 flex-1 space-y-4 overflow-y-auto rounded-2xl border border-border bg-surface/30 p-4">
        {mensagens.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <p className="text-sm text-muted">
              Converse comigo sobre seus editais, sua empresa ou seus estudos de viabilidade — ou peça pra eu gerar
              uma planilha, um PDF ou um ZIP.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGESTOES.map((s) => (
                <button
                  key={s}
                  onClick={() => enviarMensagem(s)}
                  className="rounded-full border border-border bg-background px-3 py-1.5 text-xs text-foreground hover:bg-surface"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {mensagens.map((m, i) => (
          <div key={i} className={`flex gap-2 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            {m.role === "assistant" && (
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-light text-brand">
                <Bot className="h-3.5 w-3.5" />
              </div>
            )}
            <div
              className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm ${
                m.role === "user" ? "bg-brand text-white" : "border border-border bg-background text-foreground"
              }`}
            >
              <p className="whitespace-pre-wrap">{m.content}</p>
              {m.arquivos && m.arquivos.length > 0 && (
                <div className="mt-2 space-y-1.5">
                  {m.arquivos.map((a, j) => (
                    <button
                      key={j}
                      onClick={() => baixarArquivo(a)}
                      className="flex w-full items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-left text-xs text-foreground hover:bg-brand-light"
                    >
                      <Download className="h-3.5 w-3.5 shrink-0 text-brand" />
                      <span className="min-w-0 flex-1 truncate">{a.nome}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {m.role === "user" && (
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface text-muted">
                <User className="h-3.5 w-3.5" />
              </div>
            )}
          </div>
        ))}

        {enviando && (
          <div className="flex items-center gap-2 pl-8 text-xs text-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Bidd.IA está pensando...
          </div>
        )}
      </div>

      <div className="mt-3">
        {erro && <p className="mb-2 text-xs text-danger">{erro}</p>}
        <div className="flex items-end gap-2">
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                enviarMensagem(texto);
              }
            }}
            rows={1}
            disabled={enviando}
            placeholder="Pergunte à Bidd.IA sobre seus editais, ou peça um arquivo..."
            className="max-h-32 flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
          />
          <Button onClick={() => enviarMensagem(texto)} loading={enviando} disabled={!texto.trim()} className="shrink-0 px-3">
            {!enviando && <Send className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}
