"use client";

import { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Sparkles, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  CATEGORIAS_CATALOGO,
  chaveEfetivaDoDocumento,
  itemAceitaVarios,
  itemPorChave,
  itensDaCategoria,
} from "@/lib/catalogo-documentos";
import type { CompanyDocumentItem, FormaDocumento } from "@/lib/types";
import { analisarArquivo, enviarDocumento, TAMANHO_MAXIMO_ANEXO } from "@/components/documentos/enviar-documento";

type Linha = {
  id: string;
  arquivo: File;
  analisando: boolean;
  /** "" = Outros */
  pasta: string;
  /** "" = documento personalizado (nome livre) */
  item: string;
  nomeLivre: string;
  temValidade: boolean;
  validade: string;
  dataEmissao: string;
  forma: FormaDocumento;
  avisoCnpj: string | null;
  reconhecido: "alta" | "media" | null;
  status: "pendente" | "enviando" | "ok" | "erro";
  erro: string | null;
};

const selectClass =
  "mt-1 block w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:border-brand focus:outline-none";

function tamanho(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

let contador = 0;

export function EnvioEmLote({
  documentos,
  onConcluido,
  onFechar,
}: {
  documentos: CompanyDocumentItem[];
  onConcluido: () => void;
  onFechar: () => void;
}) {
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [salvando, setSalvando] = useState(false);
  const entradaRef = useRef<HTMLInputElement>(null);

  const atualizar = (id: string, mudanca: Partial<Linha>) =>
    setLinhas((ls) => ls.map((l) => (l.id === id ? { ...l, ...mudanca } : l)));

  async function escolherArquivos(lista: FileList | null) {
    if (!lista || lista.length === 0) return;
    const novas: Linha[] = Array.from(lista).map((arquivo) => ({
      id: `l${++contador}`,
      arquivo,
      analisando: true,
      pasta: "",
      item: "",
      nomeLivre: arquivo.name.replace(/\.[a-z0-9]{2,5}$/i, "").slice(0, 200),
      temValidade: false,
      validade: "",
      dataEmissao: "",
      forma: "COPIA_SIMPLES",
      avisoCnpj: null,
      reconhecido: null,
      status: "pendente",
      erro: arquivo.size > TAMANHO_MAXIMO_ANEXO ? `Arquivo muito grande (máx. ${TAMANHO_MAXIMO_ANEXO / 1024 / 1024} MB).` : null,
    }));
    setLinhas((ls) => [...ls, ...novas]);
    if (entradaRef.current) entradaRef.current.value = "";

    // Reconhece cada arquivo (sem IA), dois de cada vez para não pesar.
    const fila = novas.filter((n) => !n.erro);
    for (const n of novas.filter((x) => x.erro)) atualizar(n.id, { analisando: false });
    async function trabalhador() {
      for (let l = fila.shift(); l; l = fila.shift()) {
        const analise = await analisarArquivo(l.arquivo);
        const item = itemPorChave(analise?.sugestao?.chave);
        atualizar(l.id, {
          analisando: false,
          ...(item && analise?.sugestao
            ? {
                pasta: item.categoria,
                item: item.chave,
                reconhecido: analise.sugestao.confianca,
                temValidade: !!analise.validade || !!item.vence,
              }
            : {}),
          validade: analise?.validade ?? "",
          dataEmissao: analise?.dataEmissao ?? "",
          avisoCnpj: analise?.avisoCnpj ?? null,
        });
      }
    }
    await Promise.all([trabalhador(), trabalhador()]);
  }

  // Quantos documentos cada item já tem na empresa — para avisar o que será substituído.
  const jaTem = new Map<string, number>();
  for (const d of documentos) {
    const chave = chaveEfetivaDoDocumento(d);
    if (chave) jaTem.set(chave, (jaTem.get(chave) ?? 0) + 1);
  }
  const usadosNoLote = new Map<string, number>();
  for (const l of linhas) if (l.item && l.status !== "ok") usadosNoLote.set(l.item, (usadosNoLote.get(l.item) ?? 0) + 1);

  function problema(l: Linha): string | null {
    if (l.erro && l.status !== "erro") return l.erro;
    if (!l.item && !l.nomeLivre.trim()) return "Informe o nome do documento.";
    if (l.temValidade && !l.validade) return "Informe a data de validade ou desmarque.";
    return null;
  }

  const pendentes = linhas.filter((l) => l.status === "pendente" || l.status === "erro");
  const todosProntos = pendentes.length > 0 && pendentes.every((l) => !problema(l) && !l.analisando);

  async function salvarTodos() {
    setSalvando(true);
    let algumOk = false;
    for (const l of linhas) {
      if (l.status === "ok") continue;
      atualizar(l.id, { status: "enviando", erro: null });
      const item = itemPorChave(l.item);
      const r = await enviarDocumento(l.arquivo, {
        ...(item ? { catalogoChave: item.chave } : { tipo: l.nomeLivre.trim(), pasta: l.pasta || null }),
        forma: l.forma,
        dataEmissao: l.dataEmissao || null,
        validade: l.temValidade ? l.validade || null : null,
        adicionar: item ? itemAceitaVarios(item.chave) : false,
        semReavaliar: true,
      });
      if (r.ok) {
        algumOk = true;
        atualizar(l.id, { status: "ok" });
      } else {
        atualizar(l.id, { status: "erro", erro: r.erro });
      }
    }
    // Uma única conferência dos editais para o lote inteiro (em vez de uma por arquivo).
    if (algumOk) await fetch("/api/company/documents/reavaliar", { method: "POST" }).catch(() => null);
    setSalvando(false);
    onConcluido();
  }

  const tudoEnviado = linhas.length > 0 && linhas.every((l) => l.status === "ok");

  return (
    <div className="mt-5 rounded-2xl border border-brand/30 bg-brand-light/20 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">Enviar documentos</p>
          <p className="mt-0.5 text-xs text-muted">
            Escolha quantos arquivos quiser. O sistema tenta reconhecer cada um (pelo nome e pelo texto do PDF, sem custo) e
            sugere a pasta e o item; <strong>você confere e confirma</strong>. É o item escolhido que decide em quais
            editais o documento será usado.
          </p>
        </div>
        <button type="button" onClick={onFechar} className="text-muted hover:text-foreground" aria-label="Fechar">
          <X className="h-4 w-4" />
        </button>
      </div>

      <label className="mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-background px-4 py-5 text-sm text-muted hover:border-brand hover:text-brand">
        <Upload className="h-4 w-4" /> Escolher arquivos
        <input
          ref={entradaRef}
          type="file"
          multiple
          className="sr-only"
          onChange={(e) => escolherArquivos(e.target.files)}
        />
      </label>

      {linhas.length > 0 && (
        <ul className="mt-4 space-y-3">
          {linhas.map((l) => {
            const itensDaPasta = l.pasta ? itensDaCategoria(l.pasta as never) : [];
            const item = itemPorChave(l.item);
            const msg = l.status === "ok" ? null : problema(l);
            const existentes = item ? (jaTem.get(item.chave) ?? 0) : 0;
            const repetidoNoLote = item && (usadosNoLote.get(item.chave) ?? 0) > 1 && !itemAceitaVarios(item.chave);
            return (
              <li key={l.id} className="rounded-xl border border-border bg-background p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="min-w-0 truncate text-sm font-medium text-foreground">
                    {l.arquivo.name} <span className="font-normal text-muted">· {tamanho(l.arquivo.size)}</span>
                  </p>
                  <span className="flex items-center gap-1.5 text-xs">
                    {l.analisando && (
                      <span className="inline-flex items-center gap-1 text-muted">
                        <Loader2 className="h-3 w-3 animate-spin" /> Lendo o arquivo…
                      </span>
                    )}
                    {!l.analisando && l.reconhecido && l.status !== "ok" && (
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${
                          l.reconhecido === "alta" ? "bg-accent/10 text-accent" : "bg-warning/10 text-warning"
                        }`}
                        title={l.reconhecido === "alta" ? "Reconhecido pelo conteúdo do arquivo." : "Reconhecido só pelo nome — confira."}
                      >
                        <Sparkles className="h-3 w-3" /> {l.reconhecido === "alta" ? "Reconhecido" : "Confira o item"}
                      </span>
                    )}
                    {l.status === "enviando" && <Loader2 className="h-4 w-4 animate-spin text-brand" />}
                    {l.status === "ok" && (
                      <span className="inline-flex items-center gap-1 font-medium text-accent">
                        <CheckCircle2 className="h-4 w-4" /> Enviado
                      </span>
                    )}
                    {l.status !== "ok" && l.status !== "enviando" && !salvando && (
                      <button
                        type="button"
                        onClick={() => setLinhas((ls) => ls.filter((x) => x.id !== l.id))}
                        className="text-muted hover:text-danger"
                        aria-label={`Tirar ${l.arquivo.name} da lista`}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </span>
                </div>

                {l.status !== "ok" && (
                  <>
                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <label className="text-xs text-muted">
                        Pasta
                        <select
                          className={selectClass}
                          value={l.pasta}
                          disabled={salvando}
                          onChange={(e) => atualizar(l.id, { pasta: e.target.value, item: "" })}
                        >
                          <option value="">Outros</option>
                          {CATEGORIAS_CATALOGO.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.titulo}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-xs text-muted">
                        Item
                        <select
                          className={selectClass}
                          value={l.item}
                          disabled={salvando}
                          onChange={(e) => {
                            const novo = itemPorChave(e.target.value);
                            atualizar(l.id, { item: e.target.value, ...(novo?.vence ? { temValidade: true } : {}) });
                          }}
                        >
                          <option value="">Outro documento (dou um nome)</option>
                          {itensDaPasta.map((i) => (
                            <option key={i.chave} value={i.chave}>
                              {i.nome.length > 70 ? `${i.nome.slice(0, 67)}…` : i.nome}
                            </option>
                          ))}
                        </select>
                      </label>
                      {!l.item && (
                        <label className="text-xs text-muted sm:col-span-2">
                          Nome do documento
                          <input
                            className={selectClass}
                            value={l.nomeLivre}
                            disabled={salvando}
                            maxLength={200}
                            onChange={(e) => atualizar(l.id, { nomeLivre: e.target.value })}
                          />
                        </label>
                      )}
                      <div className="text-xs text-muted">
                        <label className="flex items-center gap-1.5">
                          <input
                            type="checkbox"
                            className="accent-brand"
                            checked={l.temValidade}
                            disabled={salvando}
                            onChange={(e) => atualizar(l.id, { temValidade: e.target.checked })}
                          />
                          Tem data de validade
                        </label>
                        {l.temValidade && (
                          <input
                            type="date"
                            className={selectClass}
                            value={l.validade}
                            disabled={salvando}
                            onChange={(e) => atualizar(l.id, { validade: e.target.value })}
                          />
                        )}
                      </div>
                    </div>

                    {l.avisoCnpj && (
                      <p className="mt-2 flex items-start gap-1.5 text-xs text-warning">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {l.avisoCnpj}
                      </p>
                    )}
                    {item && existentes > 0 && !repetidoNoLote && (
                      <p className="mt-2 text-xs text-muted">
                        {itemAceitaVarios(item.chave)
                          ? `Este item já tem ${existentes} documento(s); este será adicionado ao lado deles.`
                          : "Este item já tem um documento; o novo vai substituí-lo."}
                      </p>
                    )}
                    {repetidoNoLote && (
                      <p className="mt-2 flex items-start gap-1.5 text-xs text-warning">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Há mais de um arquivo para este mesmo item e ele
                        guarda só um: fica o último da lista.
                      </p>
                    )}
                    {(msg || l.erro) && <p className="mt-2 text-xs text-danger">{l.erro ?? msg}</p>}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onFechar}>
          {tudoEnviado ? "Fechar" : "Cancelar"}
        </Button>
        {!tudoEnviado && (
          <Button type="button" onClick={salvarTodos} loading={salvando} disabled={!todosProntos}>
            Salvar {pendentes.length > 0 ? `${pendentes.length} documento(s)` : "documentos"}
          </Button>
        )}
      </div>
    </div>
  );
}
