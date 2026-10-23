"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Loader2, Send, User } from "lucide-react";
import { AvatarBidd } from "@/components/ui/Marca";
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
    <div className="mx-auto flex h-[calc(100dvh-9rem)] w-full max-w-3xl flex-col px-[var(--gutter)] py-4 md:h-[calc(100dvh-4rem)] md:py-6">
      <div className="flex items-center gap-3">
        <AvatarBidd tamanho={44} />
        <div className="min-w-0">
          <h1 className="tipo-titulo-2 text-ink">Bidd.IA</h1>
          <p className="tipo-pequeno text-ink-muted">
            <span className="md:hidden">Assistente com os 6 agentes</span>
            <span className="hidden md:inline">Pergunte sobre qualquer processo ou peça pra gerar um arquivo.</span>
          </p>
        </div>
      </div>

      <div ref={listRef} className="mt-4 flex-1 space-y-4 overflow-y-auto">
        {mensagens.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <p className="tipo-corpo max-w-md text-ink-muted">
              Converse comigo sobre seus editais, sua empresa ou seus estudos de viabilidade — ou peça pra eu gerar
              uma planilha, um PDF ou um ZIP.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGESTOES.map((s) => (
                <button
                  key={s}
                  onClick={() => enviarMensagem(s)}
                  className="min-h-11 rounded-pill bg-surface px-4 text-[13px] font-bold text-ink shadow-card hover:bg-tint"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {mensagens.map((m, i) => (
          <div key={i} className={`flex items-end gap-2 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            {m.role === "assistant" && <AvatarBidd tamanho={28} />}
            <div
              className={`max-w-[85%] rounded-card px-4 py-3 ${
                m.role === "user" ? "rounded-br-chip bg-brand-600 text-on-brand" : "rounded-bl-chip bg-surface text-ink shadow-card"
              }`}
            >
              <p className="tipo-corpo whitespace-pre-wrap">{m.content}</p>
              {m.arquivos && m.arquivos.length > 0 && (
                <div className="mt-2 space-y-1.5">
                  {m.arquivos.map((a, j) => (
                    <button
                      key={j}
                      onClick={() => baixarArquivo(a)}
                      className="flex min-h-11 w-full items-center gap-2 rounded-tile bg-tint px-3 text-left text-[13px] font-bold text-tint-ink hover:brightness-95"
                    >
                      <Download className="h-4 w-4 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{a.nome}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {m.role === "user" && (
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-tint text-tint-ink" aria-hidden>
                <User className="h-3.5 w-3.5" />
              </div>
            )}
          </div>
        ))}

        {enviando && (
          <div className="tipo-pequeno flex items-center gap-2 pl-9 text-ink-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Bidd.IA está pensando...
          </div>
        )}
      </div>

      <div className="mt-3">
        {erro && <p className="tipo-pequeno mb-2 text-danger-ink">{erro}</p>}
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
            className="tipo-corpo max-h-32 min-h-11 flex-1 resize-none rounded-card bg-surface px-4 py-2.5 text-ink shadow-card placeholder:text-ink-muted/70 focus:outline-none focus:ring-2 focus:ring-focus-ring/40"
          />
          <Button onClick={() => enviarMensagem(texto)} loading={enviando} disabled={!texto.trim()} aria-label="Enviar" className="h-11 w-11 shrink-0 !px-0">
            {!enviando && <Send className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}
