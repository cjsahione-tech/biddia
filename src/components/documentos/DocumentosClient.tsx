"use client";

import { useEffect, useState } from "react";
import { Plus, X, Download, Trash2, Loader2, FileStack } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, TextInput, Select } from "@/components/ui/Field";
import { ORDEM_CATEGORIAS, LABEL_CATEGORIA, LABEL_OUTROS } from "@/lib/habilitacao-categorias";
import { CHECKLIST_BASE, CATEGORIA_BASE } from "@/lib/checklist-base";
import type { CompanyDocumentItem, FormaDocumento, HabilitacaoCategoria } from "@/lib/types";

// Mesmos tetos usados no checklist: arquivo pequeno vai embutido em base64 no corpo da
// requisição; acima disso, vai direto pro Storage via URL assinada (ver upload-url).
const TAMANHO_MAXIMO_BASE64 = 3.5 * 1024 * 1024;
const TAMANHO_MAXIMO_ANEXO = 25 * 1024 * 1024;

const FORMA_LABEL: Record<FormaDocumento, string> = {
  COPIA_SIMPLES: "Cópia simples",
  AUTENTICADO: "Autenticado em cartório",
  ASSINATURA_DIGITAL: "Assinatura digital (ICP-Brasil)",
};

const CATEGORIAS_SELECT: HabilitacaoCategoria[] = [
  "FISCAL_TRABALHISTA_ECONOMICO_FINANCEIRA_JURIDICA",
  "QUALIFICACAO_TECNICA_EMPRESA",
  "QUALIFICACAO_EQUIPE_TECNICA",
  "GARANTIA_CONTRATO",
];

function lerComoBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function enviarParaStorage(signedUrl: string, file: File) {
  const res = await fetch(signedUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!res.ok) throw new Error(`Falha no upload para o armazenamento (${res.status}).`);
}

function statusValidade(validade: string | null): { label: string; className: string } {
  if (!validade) return { label: "Não vence", className: "text-muted bg-muted/10" };
  const dias = Math.ceil((new Date(validade).getTime() - Date.now()) / 86_400_000);
  if (dias < 0) return { label: "Vencido", className: "text-danger bg-danger/10" };
  if (dias <= 30) return { label: `Vence em ${dias} dia(s)`, className: "text-warning bg-warning/10" };
  return { label: "Vigente", className: "text-accent bg-accent/10" };
}

function DocumentoRow({ doc, onRemoved }: { doc: CompanyDocumentItem; onRemoved: (id: string) => void }) {
  const [excluindo, setExcluindo] = useState(false);
  const badge = statusValidade(doc.validade);

  async function excluir() {
    if (!confirm(`Remover "${doc.tipo}" do dossiê? Isso não afeta checklists já preenchidos com ele.`)) return;
    setExcluindo(true);
    const res = await fetch(`/api/company/documents/${doc.id}`, { method: "DELETE" });
    if (res.ok) onRemoved(doc.id);
    setExcluindo(false);
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-3 last:border-0">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">{doc.tipo}</p>
        <p className="truncate text-xs text-muted">{doc.nome}</p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <span className="rounded-full bg-muted/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
          {FORMA_LABEL[doc.forma]}
        </span>
        <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${badge.className}`}>
          {badge.label}
        </span>
        <a
          href={`/api/company/documents/${doc.id}/download`}
          target="_blank"
          rel="noreferrer"
          className="text-muted hover:text-brand"
          title="Baixar"
        >
          <Download className="h-4 w-4" />
        </a>
        <button onClick={excluir} disabled={excluindo} className="text-muted hover:text-danger disabled:opacity-50" title="Remover">
          {excluindo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

function NovoDocumentoForm({ onCriado, onCancelar }: { onCriado: () => void; onCancelar: () => void }) {
  const [tipo, setTipo] = useState(CHECKLIST_BASE[0]);
  const [tipoLivre, setTipoLivre] = useState("");
  const [categoria, setCategoria] = useState<HabilitacaoCategoria | "">(CATEGORIA_BASE[CHECKLIST_BASE[0]] ?? "");
  const [forma, setForma] = useState<FormaDocumento>("COPIA_SIMPLES");
  const [dataEmissao, setDataEmissao] = useState("");
  const [temValidade, setTemValidade] = useState(true);
  const [validade, setValidade] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const ehOutro = tipo === "OUTRO";

  function handleTipoChange(valor: string) {
    setTipo(valor);
    setCategoria(CATEGORIA_BASE[valor] ?? "");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);

    const tipoFinal = ehOutro ? tipoLivre.trim() : tipo;
    if (!tipoFinal) {
      setErro("Informe o tipo do documento.");
      return;
    }
    if (!arquivo) {
      setErro("Selecione o arquivo.");
      return;
    }
    if (arquivo.size > TAMANHO_MAXIMO_ANEXO) {
      setErro(`Arquivo muito grande (máx. ${(TAMANHO_MAXIMO_ANEXO / 1024 / 1024).toFixed(0)}MB).`);
      return;
    }

    const metadados = {
      tipo: tipoFinal,
      categoria: categoria || null,
      forma,
      dataEmissao: dataEmissao || null,
      validade: temValidade ? validade || null : null,
      nome: arquivo.name,
    };

    setSalvando(true);
    try {
      if (arquivo.size <= TAMANHO_MAXIMO_BASE64) {
        const conteudoBase64 = await lerComoBase64(arquivo);
        const res = await fetch("/api/company/documents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...metadados, conteudoBase64 }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          setErro(data?.error ?? "Não foi possível salvar o documento.");
          return;
        }
      } else {
        const criarRes = await fetch("/api/company/documents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(metadados),
        });
        const criado = await criarRes.json().catch(() => null);
        if (!criarRes.ok) {
          setErro(criado?.error ?? "Não foi possível salvar o documento.");
          return;
        }

        const urlRes = await fetch(`/api/company/documents/${criado.documento.id}/upload-url`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nomeArquivo: arquivo.name, tamanhoBytes: arquivo.size }),
        });
        const urlData = await urlRes.json().catch(() => null);
        if (!urlRes.ok) {
          setErro(urlData?.error ?? "Não foi possível preparar o upload.");
          return;
        }

        await enviarParaStorage(urlData.signedUrl, arquivo);
        await fetch(`/api/company/documents/${criado.documento.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ storagePath: urlData.path }),
        });
      }
      onCriado();
    } catch {
      setErro("Não foi possível salvar o documento. Tente novamente.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl border border-border p-6">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-foreground">Adicionar documento ao dossiê</p>
        <button type="button" onClick={onCancelar} className="text-muted hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Tipo de documento" htmlFor="tipo">
          <Select id="tipo" value={tipo} onChange={(e) => handleTipoChange(e.target.value)}>
            {CHECKLIST_BASE.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
            <option value="OUTRO">Outro...</option>
          </Select>
        </Field>

        {ehOutro && (
          <Field label="Descreva o tipo" htmlFor="tipoLivre">
            <TextInput
              id="tipoLivre"
              value={tipoLivre}
              onChange={(e) => setTipoLivre(e.target.value)}
              placeholder="Ex: Licença Sanitária"
            />
          </Field>
        )}

        <Field label="Categoria de habilitação" htmlFor="categoria" hint="Usada pra agrupar junto com o checklist de cada edital.">
          <Select id="categoria" value={categoria} onChange={(e) => setCategoria(e.target.value as HabilitacaoCategoria | "")}>
            <option value="">Não classificado</option>
            {CATEGORIAS_SELECT.map((c) => (
              <option key={c} value={c}>
                {LABEL_CATEGORIA[c]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Forma do documento" htmlFor="forma" hint="A validação se atende a exigência do edital continua sua.">
          <Select id="forma" value={forma} onChange={(e) => setForma(e.target.value as FormaDocumento)}>
            {(Object.keys(FORMA_LABEL) as FormaDocumento[]).map((f) => (
              <option key={f} value={f}>
                {FORMA_LABEL[f]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Data de emissão" htmlFor="dataEmissao" hint="Opcional.">
          <TextInput id="dataEmissao" type="date" value={dataEmissao} onChange={(e) => setDataEmissao(e.target.value)} />
        </Field>

        <Field label="Validade" htmlFor="validade">
          <label className="mt-1.5 flex items-center gap-1.5 text-xs text-muted">
            <input
              type="checkbox"
              checked={temValidade}
              onChange={(e) => setTemValidade(e.target.checked)}
              className="accent-brand"
            />
            Tem data de validade
          </label>
          {temValidade && (
            <TextInput id="validade" type="date" value={validade} onChange={(e) => setValidade(e.target.value)} className="mt-1.5" />
          )}
        </Field>

        <Field label="Arquivo" htmlFor="arquivo">
          <input
            id="arquivo"
            type="file"
            onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
            className="mt-1.5 block w-full text-sm text-foreground file:mr-3 file:rounded-lg file:border file:border-border file:bg-surface file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-foreground"
          />
        </Field>
      </div>

      {erro && <p className="mt-3 text-xs text-danger">{erro}</p>}

      <div className="mt-5 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancelar}>
          Cancelar
        </Button>
        <Button type="submit" loading={salvando}>
          Salvar documento
        </Button>
      </div>
    </form>
  );
}

export function DocumentosClient() {
  const [documentos, setDocumentos] = useState<CompanyDocumentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [mostrarForm, setMostrarForm] = useState(false);

  async function load() {
    const res = await fetch("/api/company/documents");
    const data = await res.json();
    setDocumentos(data.documentos ?? []);
    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- busca inicial ao montar a tela
    load();
  }, []);

  const grupos: { label: string; itens: CompanyDocumentItem[] }[] = ORDEM_CATEGORIAS.map((categoria) => ({
    label: LABEL_CATEGORIA[categoria],
    itens: documentos.filter((d) => d.categoria === categoria),
  })).filter((g) => g.itens.length > 0);

  const semCategoria = documentos.filter((d) => d.categoria === null);
  if (semCategoria.length > 0) grupos.push({ label: LABEL_OUTROS, itens: semCategoria });

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Documentos</h1>
          <p className="mt-1 text-sm text-muted">
            Dossiê da empresa: certidões, contrato social e demais documentos reutilizáveis entre licitações. O
            Agente Secretário usa isso pra preencher sozinho os itens padrão do checklist de cada edital novo —
            sem precisar reenviar o mesmo documento sempre, desde que ele ainda esteja dentro da validade.
          </p>
        </div>
        {!mostrarForm && (
          <Button onClick={() => setMostrarForm(true)} className="shrink-0">
            <Plus className="h-4 w-4" /> Adicionar documento
          </Button>
        )}
      </div>

      {mostrarForm && (
        <div className="mt-6">
          <NovoDocumentoForm
            onCriado={() => {
              setMostrarForm(false);
              load();
            }}
            onCancelar={() => setMostrarForm(false)}
          />
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-24 text-muted">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : documentos.length === 0 ? (
        <div className="mt-10 rounded-xl border border-dashed border-border py-16 text-center">
          <FileStack className="mx-auto h-8 w-8 text-muted/50" />
          <p className="mt-3 text-sm text-muted">
            Nenhum documento no dossiê ainda. Adicione as certidões e o contrato social da empresa uma vez — eles
            passam a preencher sozinhos os itens padrão do checklist de cada edital novo.
          </p>
        </div>
      ) : (
        <div className="mt-8 space-y-8">
          {grupos.map((grupo) => (
            <div key={grupo.label}>
              <h4 className="text-sm font-semibold text-foreground">{grupo.label}</h4>
              <div className="mt-2 rounded-2xl border border-border px-4">
                {grupo.itens.map((doc) => (
                  <DocumentoRow key={doc.id} doc={doc} onRemoved={(id) => setDocumentos((prev) => prev.filter((d) => d.id !== id))} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
