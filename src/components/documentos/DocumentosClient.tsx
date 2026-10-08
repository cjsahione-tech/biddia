"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Download, Trash2, Loader2, ChevronDown, ChevronRight, Upload, RefreshCw, CalendarDays, Info } from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  CATEGORIAS_CATALOGO,
  CATALOGO_DOCUMENTOS,
  ROTULO_APLICACAO,
  chaveEfetivaDoDocumento,
  itensDaCategoria,
  type Aplicacao,
  type ItemCatalogo,
} from "@/lib/catalogo-documentos";
import type { CompanyDocumentItem } from "@/lib/types";
import { FormularioEnvioDocumento, FORMA_LABEL } from "@/components/documentos/FormularioEnvioDocumento";

type Filtro = "TODOS" | "P" | "S";

type SituacaoDoc = "ENVIADO" | "VENCIDO" | "VENCE_EM_BREVE" | "NAO_ENVIADO";

function situacao(doc: CompanyDocumentItem | undefined): { tipo: SituacaoDoc; label: string; className: string; detalhe: string } {
  if (!doc) return { tipo: "NAO_ENVIADO", label: "Não enviado", className: "text-muted bg-muted/10", detalhe: "" };
  if (!doc.validade) return { tipo: "ENVIADO", label: "Enviado", className: "text-accent bg-accent/10", detalhe: "Não vence" };
  const dias = Math.ceil((new Date(doc.validade).getTime() - Date.now()) / 86_400_000);
  const dataBr = new Date(doc.validade).toLocaleDateString("pt-BR", { timeZone: "UTC" });
  if (dias < 0) return { tipo: "VENCIDO", label: "Vencido", className: "text-danger bg-danger/10", detalhe: `venceu em ${dataBr}` };
  if (dias <= 7)
    return { tipo: "VENCE_EM_BREVE", label: "Enviado", className: "text-warning bg-warning/10", detalhe: `vence em ${dias} dia(s) — ${dataBr}` };
  return { tipo: "ENVIADO", label: "Enviado", className: "text-accent bg-accent/10", detalhe: `válido até ${dataBr}` };
}

function ChipAplicacao({ aplicacao }: { aplicacao: Aplicacao }) {
  const texto = aplicacao === "PS" ? "P+S" : aplicacao;
  return (
    <span
      title={ROTULO_APLICACAO[aplicacao]}
      className="shrink-0 rounded-md bg-surface px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-muted"
    >
      {texto}
    </span>
  );
}

type Edicao =
  | { chave: string; modo: "enviar" | "validade" }
  | { personalizado: true }
  | null;

export function DocumentosClient() {
  const [documentos, setDocumentos] = useState<CompanyDocumentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>("TODOS");
  // Todas as categorias começam minimizadas.
  const [abertas, setAbertas] = useState<Set<string>>(new Set());
  const [edicao, setEdicao] = useState<Edicao>(null);
  const [removendoId, setRemovendoId] = useState<string | null>(null);
  const [classificandoId, setClassificandoId] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch("/api/company/documents");
      if (!res.ok) throw new Error();
      const data = await res.json();
      setDocumentos(data.documentos ?? []);
      setErroCarga(null);
    } catch {
      setErroCarga("Não foi possível carregar os documentos. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- busca inicial ao montar a tela
    load();
  }, []);

  // Um documento por item do catálogo (o mais recente); o que não casa com nenhum item vai
  // para "Outros" — inclusive documentos antigos com tipo livre, que continuam todos aqui.
  const { porChave, outros } = useMemo(() => {
    const mapa = new Map<string, CompanyDocumentItem>();
    const resto: CompanyDocumentItem[] = [];
    const ordenados = [...documentos].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    for (const d of ordenados) {
      const chave = chaveEfetivaDoDocumento(d);
      if (chave && !mapa.has(chave)) mapa.set(chave, d);
      else resto.push(d);
    }
    return { porChave: mapa, outros: resto };
  }, [documentos]);

  const visivel = (i: ItemCatalogo) => filtro === "TODOS" || i.aplicacao === "PS" || i.aplicacao === filtro;

  const itensVisiveis = CATALOGO_DOCUMENTOS.filter(visivel);
  const totalEnviados = itensVisiveis.filter((i) => porChave.has(i.chave)).length;

  function alternar(id: string) {
    setAbertas((s) => {
      const novo = new Set(s);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  }

  async function remover(doc: CompanyDocumentItem) {
    if (!confirm(`Remover "${doc.tipo}"? Isso não afeta checklists já preenchidos com ele.`)) return;
    setRemovendoId(doc.id);
    try {
      const res = await fetch(`/api/company/documents/${doc.id}`, { method: "DELETE" });
      if (res.ok) setDocumentos((prev) => prev.filter((d) => d.id !== doc.id));
      else alert("Não foi possível remover o documento.");
    } finally {
      setRemovendoId(null);
    }
  }

  async function classificar(doc: CompanyDocumentItem, catalogoChave: string) {
    if (!catalogoChave) return;
    setClassificandoId(doc.id);
    try {
      const res = await fetch(`/api/company/documents/${doc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ catalogoChave }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        alert(data?.error ?? "Não foi possível classificar o documento.");
        return;
      }
      await load();
    } finally {
      setClassificandoId(null);
    }
  }

  function aposSalvar() {
    setEdicao(null);
    load();
  }

  // Funções de desenho (não componentes): um componente criado aqui dentro seria recriado a cada
  // renderização e apagaria o que o usuário digitou no formulário aberto.
  function botoesDoc(doc: CompanyDocumentItem, chave?: string) {
    return (
      <div className="flex items-center gap-1.5">
        <a
          href={`/api/company/documents/${doc.id}/download`}
          target="_blank"
          rel="noreferrer"
          className="rounded-md p-1.5 text-muted hover:bg-surface hover:text-brand"
          title="Ver / baixar"
        >
          <Download className="h-4 w-4" />
        </a>
        {chave && (
          <>
            <button
              onClick={() => setEdicao({ chave, modo: "validade" })}
              className="rounded-md p-1.5 text-muted hover:bg-surface hover:text-brand"
              title="Alterar validade"
            >
              <CalendarDays className="h-4 w-4" />
            </button>
            <button
              onClick={() => setEdicao({ chave, modo: "enviar" })}
              className="rounded-md p-1.5 text-muted hover:bg-surface hover:text-brand"
              title="Substituir arquivo"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </>
        )}
        <button
          onClick={() => remover(doc)}
          disabled={removendoId === doc.id}
          className="rounded-md p-1.5 text-muted hover:bg-surface hover:text-danger disabled:opacity-50"
          title="Remover"
        >
          {removendoId === doc.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        </button>
      </div>
    );
  }

  function linhaItem(item: ItemCatalogo) {
    const doc = porChave.get(item.chave);
    const sit = situacao(doc);
    const editandoAqui = edicao && "chave" in edicao && edicao.chave === item.chave ? edicao : null;
    return (
      <div className="border-b border-border py-3 last:border-0">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-2">
              <ChipAplicacao aplicacao={item.aplicacao} />
              <p className="text-sm font-medium text-foreground">{item.nome}</p>
            </div>
            {item.descricao && <p className="mt-0.5 pl-9 text-xs text-muted">{item.descricao}</p>}
            {item.nota && (
              <p className="mt-1 flex items-start gap-1 pl-9 text-xs text-muted/90">
                <Info className="mt-0.5 h-3 w-3 shrink-0" /> {item.nota}
              </p>
            )}
            {doc && (
              <p className="mt-1 truncate pl-9 text-xs text-muted">
                {doc.nome} · {FORMA_LABEL[doc.forma]}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${sit.className}`}>
              {sit.label}
              {sit.detalhe && <span className="ml-1 font-normal">· {sit.detalhe}</span>}
            </span>
            {doc ? (
              botoesDoc(doc, item.chave)
            ) : (
              <Button variant="secondary" onClick={() => setEdicao({ chave: item.chave, modo: "enviar" })}>
                <Upload className="h-3.5 w-3.5" /> Enviar
              </Button>
            )}
          </div>
        </div>
        {editandoAqui && (
          <FormularioEnvioDocumento
            catalogoChave={item.chave}
            documentoAtual={doc}
            soValidade={editandoAqui.modo === "validade"}
            venceTipicamente={item.vence}
            titulo={
              editandoAqui.modo === "validade"
                ? "Alterar validade"
                : doc
                  ? "Substituir arquivo"
                  : "Enviar documento"
            }
            onConcluido={aposSalvar}
            onCancelar={() => setEdicao(null)}
          />
        )}
      </div>
    );
  }

  const personalizadoAberto = edicao !== null && "personalizado" in edicao;
  const chavesLivres = CATALOGO_DOCUMENTOS.filter((i) => !porChave.has(i.chave));

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
      <h1 className="text-2xl font-semibold text-foreground">Documentos</h1>
      <p className="mt-1 text-sm text-muted">
        Documentação da empresa para habilitação em licitações. Envie só o que a empresa tem — todos os documentos são
        opcionais. O sistema usa isso para conferir, em cada edital, o que está atendido e o que falta.
      </p>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-lg border border-border bg-surface/50 p-1 text-xs font-medium">
          {(
            [
              ["TODOS", "Todos"],
              ["P", "Produtos [P]"],
              ["S", "Serviços [S]"],
            ] as const
          ).map(([valor, rotulo]) => (
            <button
              key={valor}
              onClick={() => setFiltro(valor)}
              className={`rounded-md px-3 py-1.5 transition ${
                filtro === valor ? "bg-background text-brand shadow-sm" : "text-muted hover:text-foreground"
              }`}
            >
              {rotulo}
            </button>
          ))}
        </div>
        <p className="text-sm text-muted">
          <strong className="text-foreground">{totalEnviados}</strong> de {itensVisiveis.length} documentos enviados
        </p>
      </div>

      {erroCarga && <p className="mt-4 text-sm text-danger">{erroCarga}</p>}

      {loading ? (
        <div className="flex items-center justify-center py-24 text-muted">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        <div className="mt-5 space-y-3">
          {CATEGORIAS_CATALOGO.map((cat) => {
            const itens = itensDaCategoria(cat.id).filter(visivel);
            if (itens.length === 0) return null;
            const enviados = itens.filter((i) => porChave.has(i.chave)).length;
            const aberta = abertas.has(cat.id);
            return (
              <section key={cat.id} className="rounded-2xl border border-border">
                <button
                  onClick={() => alternar(cat.id)}
                  aria-expanded={aberta}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {aberta ? (
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted" />
                    )}
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-foreground">{cat.titulo}</span>
                      {cat.base && <span className="block text-xs text-muted">{cat.base}</span>}
                    </span>
                  </span>
                  <span className="shrink-0 rounded-full bg-surface px-2.5 py-1 text-xs font-medium text-muted">
                    {enviados} de {itens.length} enviados
                  </span>
                </button>
                {aberta && (
                  <div className="border-t border-border px-4">
                    {cat.nota && (
                      <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-surface/60 px-3 py-2 text-xs text-muted">
                        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {cat.nota}
                      </p>
                    )}
                    {itens.map((item) => (
                      <div key={item.chave}>{linhaItem(item)}</div>
                    ))}
                  </div>
                )}
              </section>
            );
          })}

          <section className="rounded-2xl border border-border">
            <button
              onClick={() => alternar("outros")}
              aria-expanded={abertas.has("outros")}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
            >
              <span className="flex items-center gap-2">
                {abertas.has("outros") ? (
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted" />
                )}
                <span>
                  <span className="block text-sm font-semibold text-foreground">Outros</span>
                  <span className="block text-xs text-muted">Documentos personalizados da empresa</span>
                </span>
              </span>
              <span className="shrink-0 rounded-full bg-surface px-2.5 py-1 text-xs font-medium text-muted">
                {outros.length} documento(s)
              </span>
            </button>
            {abertas.has("outros") && (
              <div className="border-t border-border px-4 pb-3">
                {outros.map((doc) => {
                  const sit = situacao(doc);
                  return (
                    <div key={doc.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-3 last:border-0">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">{doc.tipo}</p>
                        <p className="truncate text-xs text-muted">
                          {doc.nome} · {FORMA_LABEL[doc.forma]}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${sit.className}`}>
                          {sit.label}
                          {sit.detalhe && <span className="ml-1 font-normal">· {sit.detalhe}</span>}
                        </span>
                        <select
                          aria-label={`Classificar ${doc.tipo} como item do catálogo`}
                          value=""
                          disabled={classificandoId === doc.id}
                          onChange={(e) => classificar(doc, e.target.value)}
                          className="max-w-[12rem] rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                        >
                          <option value="">Classificar como…</option>
                          {chavesLivres.map((i) => (
                            <option key={i.chave} value={i.chave}>
                              {i.nome.length > 60 ? `${i.nome.slice(0, 57)}…` : i.nome}
                            </option>
                          ))}
                        </select>
                        botoesDoc(doc)
                      </div>
                    </div>
                  );
                })}
                {outros.length === 0 && !personalizadoAberto && (
                  <p className="py-4 text-sm text-muted">Nenhum documento personalizado ainda.</p>
                )}
                {personalizadoAberto ? (
                  <FormularioEnvioDocumento
                    personalizado
                    titulo="Adicionar documento personalizado"
                    onConcluido={aposSalvar}
                    onCancelar={() => setEdicao(null)}
                  />
                ) : (
                  <div className="pt-3">
                    <Button variant="secondary" onClick={() => setEdicao({ personalizado: true })}>
                      <Plus className="h-4 w-4" /> Adicionar documento personalizado
                    </Button>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
