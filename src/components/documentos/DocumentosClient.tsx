"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Plus,
  Download,
  Trash2,
  Loader2,
  ChevronDown,
  ChevronRight,
  Upload,
  RefreshCw,
  CalendarDays,
  Info,
  FolderInput,
  Files,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  CATEGORIAS_CATALOGO,
  CATALOGO_DOCUMENTOS,
  ROTULO_APLICACAO,
  chaveEfetivaDoDocumento,
  itemAceitaVarios,
  itensDaCategoria,
  pastaDoDocumento,
  type Aplicacao,
  type ItemCatalogo,
} from "@/lib/catalogo-documentos";
import type { CompanyDocumentItem } from "@/lib/types";
import { FormularioEnvioDocumento, FORMA_LABEL } from "@/components/documentos/FormularioEnvioDocumento";
import { EnvioEmLote } from "@/components/documentos/EnvioEmLote";
import { Abas } from "@/components/ui/Abas";
import { PaginaConteudo } from "@/components/ui/PaginaConteudo";

type Filtro = "TODOS" | "P" | "S";

type SituacaoDoc = "ENVIADO" | "VENCIDO" | "VENCE_EM_BREVE" | "NAO_ENVIADO";

function situacao(doc: CompanyDocumentItem | undefined): { tipo: SituacaoDoc; label: string; className: string; detalhe: string } {
  if (!doc) return { tipo: "NAO_ENVIADO", label: "Não enviado", className: "text-muted bg-muted/10", detalhe: "" };
  if (!doc.validade) return { tipo: "ENVIADO", label: "Enviado", className: "text-success-ink bg-success-bg", detalhe: "Não vence" };
  const dias = Math.ceil((new Date(doc.validade).getTime() - Date.now()) / 86_400_000);
  const dataBr = new Date(doc.validade).toLocaleDateString("pt-BR", { timeZone: "UTC" });
  if (dias < 0) return { tipo: "VENCIDO", label: "Vencido", className: "text-danger-ink bg-danger-bg", detalhe: `venceu em ${dataBr}` };
  if (dias <= 7)
    return { tipo: "VENCE_EM_BREVE", label: "Enviado", className: "text-warning-ink bg-warning-bg", detalhe: `vence em ${dias} dia(s) — ${dataBr}` };
  return { tipo: "ENVIADO", label: "Enviado", className: "text-success-ink bg-success-bg", detalhe: `válido até ${dataBr}` };
}

function ChipAplicacao({ aplicacao }: { aplicacao: Aplicacao }) {
  const texto = aplicacao === "PS" ? "P+S" : aplicacao;
  return (
    <span
      title={ROTULO_APLICACAO[aplicacao]}
      className="shrink-0 rounded-md bg-surface px-1.5 py-0.5 text-[11px] font-semibold tracking-wide text-muted"
    >
      {texto}
    </span>
  );
}

type Edicao =
  // Ação sobre um ITEM do catálogo: enviar/substituir o arquivo, ou adicionar mais um (itens que aceitam vários).
  | { chave: string; modo: "enviar" | "adicionar" }
  // Ação sobre UM documento.
  | { docId: string; modo: "validade" | "mover" }
  // Documento personalizado numa pasta (pasta null = "Outros").
  | { personalizado: true; pasta: string | null }
  | null;

const selectClass =
  "mt-1 block w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:border-brand focus:outline-none";

/** Mover um documento para outra pasta/item. Documento de item do catálogo só troca de item; o personalizado também pode só mudar de pasta. */
function MoverDocumento({
  doc,
  onConcluido,
  onCancelar,
}: {
  doc: CompanyDocumentItem;
  onConcluido: () => void;
  onCancelar: () => void;
}) {
  const chaveAtual = chaveEfetivaDoDocumento(doc);
  const [pasta, setPasta] = useState<string>(pastaDoDocumento(doc) ?? "");
  const [item, setItem] = useState<string>(chaveAtual ?? "");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const permiteSemItem = !chaveAtual;
  const itens = pasta ? itensDaCategoria(pasta as never) : [];

  async function salvar() {
    if (!item && !permiteSemItem) {
      setErro("Escolha o item de destino.");
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      const res = await fetch(`/api/company/documents/${doc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item ? { catalogoChave: item } : { pasta: pasta || null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setErro(data?.error ?? "Não foi possível mover o documento.");
        return;
      }
      onConcluido();
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="my-2 rounded-xl border border-brand/30 bg-brand-light/20 p-4">
      <p className="text-sm font-semibold text-foreground">Mover “{doc.nome}”</p>
      <p className="mt-0.5 text-xs text-muted">
        É o item que decide em quais editais o documento será usado. Ao mover, os editais abertos são conferidos de novo.
      </p>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-xs text-muted">
          Pasta
          <select
            className={selectClass}
            value={pasta}
            onChange={(e) => {
              setPasta(e.target.value);
              setItem("");
            }}
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
          <select className={selectClass} value={item} onChange={(e) => setItem(e.target.value)}>
            {permiteSemItem ? <option value="">Só mudar de pasta (continua personalizado)</option> : <option value="">Escolha…</option>}
            {itens.map((i) => (
              <option key={i.chave} value={i.chave}>
                {i.nome.length > 70 ? `${i.nome.slice(0, 67)}…` : i.nome}
              </option>
            ))}
          </select>
        </label>
      </div>
      {erro && <p className="mt-2 text-xs text-danger-ink">{erro}</p>}
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancelar}>
          Cancelar
        </Button>
        <Button onClick={salvar} loading={salvando}>
          Mover
        </Button>
      </div>
    </div>
  );
}

export function DocumentosClient() {
  const [documentos, setDocumentos] = useState<CompanyDocumentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>("TODOS");
  // Todas as pastas começam minimizadas.
  const [abertas, setAbertas] = useState<Set<string>>(new Set());
  const [edicao, setEdicao] = useState<Edicao>(null);
  const [emLote, setEmLote] = useState(false);
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

  // Documentos por item do catálogo (mais recente primeiro) e personalizados por pasta. O que não casa
  // com nenhum item — inclusive documentos antigos com tipo livre — fica na pasta escolhida ou em "Outros".
  const { porChave, personalizadosPorPasta } = useMemo(() => {
    const mapa = new Map<string, CompanyDocumentItem[]>();
    const livres = new Map<string, CompanyDocumentItem[]>();
    const ordenados = [...documentos].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    for (const d of ordenados) {
      const chave = chaveEfetivaDoDocumento(d);
      if (chave) mapa.set(chave, [...(mapa.get(chave) ?? []), d]);
      else {
        const pasta = pastaDoDocumento(d) ?? "";
        livres.set(pasta, [...(livres.get(pasta) ?? []), d]);
      }
    }
    return { porChave: mapa, personalizadosPorPasta: livres };
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
    if (!confirm(`Remover "${doc.tipo}" (${doc.nome})? Isso não afeta checklists já preenchidos com ele.`)) return;
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

  const editandoDoc = (doc: CompanyDocumentItem) => (edicao && "docId" in edicao && edicao.docId === doc.id ? edicao : null);

  // Funções de desenho (não componentes): um componente criado aqui dentro seria recriado a cada
  // renderização e apagaria o que o usuário digitou no formulário aberto.
  function botoesDoc(doc: CompanyDocumentItem, item?: ItemCatalogo) {
    const podeSubstituir = !!item && !itemAceitaVarios(item.chave);
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
        <button
          onClick={() => setEdicao({ docId: doc.id, modo: "validade" })}
          className="rounded-md p-1.5 text-muted hover:bg-surface hover:text-brand"
          title="Alterar validade"
        >
          <CalendarDays className="h-4 w-4" />
        </button>
        {podeSubstituir && (
          <button
            onClick={() => setEdicao({ chave: item.chave, modo: "enviar" })}
            className="rounded-md p-1.5 text-muted hover:bg-surface hover:text-brand"
            title="Substituir arquivo"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        )}
        <button
          onClick={() => setEdicao({ docId: doc.id, modo: "mover" })}
          className="rounded-md p-1.5 text-muted hover:bg-surface hover:text-brand"
          title="Mover para outra pasta/item"
        >
          <FolderInput className="h-4 w-4" />
        </button>
        <button
          onClick={() => remover(doc)}
          disabled={removendoId === doc.id}
          className="rounded-md p-1.5 text-muted hover:bg-surface hover:text-danger-ink disabled:opacity-50"
          title="Remover"
        >
          {removendoId === doc.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        </button>
      </div>
    );
  }

  function chipsDoDocumento(doc: CompanyDocumentItem) {
    const sit = situacao(doc);
    return (
      <>
        <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${sit.className}`}>
          {sit.label}
          {sit.detalhe && <span className="ml-1 font-normal">· {sit.detalhe}</span>}
        </span>
        {!!doc.usos && (
          <span
            className="inline-flex items-center rounded-full bg-brand-light px-2.5 py-1 text-xs font-medium text-brand"
            title="Em quantos editais este documento está atendendo exigências de habilitação"
          >
            Atende {doc.usos} edital(is)
          </span>
        )}
      </>
    );
  }

  function formulariosDoDocumento(doc: CompanyDocumentItem) {
    const e = editandoDoc(doc);
    if (!e) return null;
    return e.modo === "validade" ? (
      <FormularioEnvioDocumento
        documentoAtual={doc}
        soValidade
        titulo="Alterar validade"
        onConcluido={aposSalvar}
        onCancelar={() => setEdicao(null)}
      />
    ) : (
      <MoverDocumento doc={doc} onConcluido={aposSalvar} onCancelar={() => setEdicao(null)} />
    );
  }

  function linhaPersonalizado(doc: CompanyDocumentItem) {
    return (
      <div key={doc.id} className="border-b border-border py-3 last:border-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">{doc.tipo}</p>
            <p className="truncate text-xs text-muted">
              {doc.nome} · {FORMA_LABEL[doc.forma]}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {chipsDoDocumento(doc)}
            <select
              aria-label={`Classificar ${doc.tipo} como item do catálogo`}
              value=""
              disabled={classificandoId === doc.id}
              onChange={(e) => classificar(doc, e.target.value)}
              className="max-w-[12rem] rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
            >
              <option value="">Classificar como…</option>
              {CATALOGO_DOCUMENTOS.filter((i) => itemAceitaVarios(i.chave) || !porChave.has(i.chave)).map((i) => (
                <option key={i.chave} value={i.chave}>
                  {i.nome.length > 60 ? `${i.nome.slice(0, 57)}…` : i.nome}
                </option>
              ))}
            </select>
            {botoesDoc(doc)}
          </div>
        </div>
        {formulariosDoDocumento(doc)}
      </div>
    );
  }

  function blocoPersonalizados(pasta: string, vazioTexto: string | null) {
    const lista = personalizadosPorPasta.get(pasta) ?? [];
    const abrindoAqui = edicao && "personalizado" in edicao && (edicao.pasta ?? "") === pasta;
    return (
      <>
        {lista.map((doc) => linhaPersonalizado(doc))}
        {lista.length === 0 && !abrindoAqui && vazioTexto && <p className="py-4 text-sm text-muted">{vazioTexto}</p>}
        {abrindoAqui ? (
          <FormularioEnvioDocumento
            personalizado
            pastaInicial={pasta || null}
            titulo="Adicionar documento personalizado"
            onConcluido={aposSalvar}
            onCancelar={() => setEdicao(null)}
          />
        ) : (
          <div className="py-3">
            <Button variant="secondary" onClick={() => setEdicao({ personalizado: true, pasta: pasta || null })}>
              <Plus className="h-4 w-4" /> Adicionar documento personalizado
            </Button>
          </div>
        )}
      </>
    );
  }

  function linhaItem(item: ItemCatalogo) {
    const docs = porChave.get(item.chave) ?? [];
    const varios = itemAceitaVarios(item.chave);
    const doc = docs[0];
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
            {varios && (
              <p className="mt-1 flex items-start gap-1 pl-9 text-xs text-muted/90">
                <Files className="mt-0.5 h-3 w-3 shrink-0" /> Aceita vários arquivos — em cada edital, o sistema usa o que estiver
                válido na data da sessão.
              </p>
            )}
            {!varios && doc && (
              <p className="mt-1 truncate pl-9 text-xs text-muted">
                {doc.nome} · {FORMA_LABEL[doc.forma]}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!varios && doc && chipsDoDocumento(doc)}
            {!varios && doc && botoesDoc(doc, item)}
            {varios && docs.length === 0 && (
              <span className="inline-flex items-center rounded-full bg-muted/10 px-2.5 py-1 text-xs font-medium text-muted">
                Não enviado
              </span>
            )}
            {varios && (
              <Button variant="secondary" onClick={() => setEdicao({ chave: item.chave, modo: "adicionar" })}>
                <Upload className="h-3.5 w-3.5" /> {docs.length === 0 ? "Enviar" : "Adicionar outro"}
              </Button>
            )}
            {!varios && !doc && (
              <>
                <span className="inline-flex items-center rounded-full bg-muted/10 px-2.5 py-1 text-xs font-medium text-muted">
                  Não enviado
                </span>
                <Button variant="secondary" onClick={() => setEdicao({ chave: item.chave, modo: "enviar" })}>
                  <Upload className="h-3.5 w-3.5" /> Enviar
                </Button>
              </>
            )}
          </div>
        </div>
        {!varios && doc && formulariosDoDocumento(doc)}
        {varios && (
          <ul className="mt-2 space-y-1 pl-9">
            {docs.map((d) => (
              <li key={d.id} className="rounded-lg bg-surface/50 px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="min-w-0 flex-1 truncate text-xs text-foreground">
                    {d.nome} <span className="text-muted">· {FORMA_LABEL[d.forma]}</span>
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    {chipsDoDocumento(d)}
                    {botoesDoc(d, item)}
                  </div>
                </div>
                {formulariosDoDocumento(d)}
              </li>
            ))}
          </ul>
        )}
        {editandoAqui && (
          <FormularioEnvioDocumento
            catalogoChave={item.chave}
            documentoAtual={editandoAqui.modo === "enviar" ? doc : undefined}
            adicionar={editandoAqui.modo === "adicionar"}
            venceTipicamente={item.vence}
            titulo={editandoAqui.modo === "adicionar" ? "Adicionar documento" : doc ? "Substituir arquivo" : "Enviar documento"}
            onConcluido={aposSalvar}
            onCancelar={() => setEdicao(null)}
          />
        )}
      </div>
    );
  }

  return (
    <PaginaConteudo
      titulo="Documentos"
      subtitulo="Documentação da empresa para habilitação em licitações. Envie só o que a empresa tem — todos os documentos são opcionais. O sistema usa isso para conferir, em cada edital, o que está atendido e o que falta."
    >

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <Abas
          variante="etapas"
          rotuloAcessivel="Filtrar documentos"
          itens={[
            { chave: "TODOS", rotulo: "Todos" },
            { chave: "P", rotulo: "Produtos [P]" },
            { chave: "S", rotulo: "Serviços [S]" },
          ]}
          ativa={filtro}
          onChange={(c) => setFiltro(c as typeof filtro)}
        />
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-muted">
            <strong className="text-foreground">{totalEnviados}</strong> de {itensVisiveis.length} documentos enviados
          </p>
          {!emLote && (
            <Button onClick={() => setEmLote(true)}>
              <Upload className="h-4 w-4" /> Enviar documentos
            </Button>
          )}
        </div>
      </div>

      {emLote && (
        <EnvioEmLote
          documentos={documentos}
          onConcluido={load}
          onFechar={() => {
            setEmLote(false);
            load();
          }}
        />
      )}

      {erroCarga && <p className="mt-4 text-sm text-danger-ink">{erroCarga}</p>}

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
            const extras = personalizadosPorPasta.get(cat.id)?.length ?? 0;
            const aberta = abertas.has(cat.id);
            return (
              <section key={cat.id} className="rounded-card bg-surface shadow-card">
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
                    {enviados} de {itens.length} enviados{extras > 0 ? ` · +${extras} personalizado(s)` : ""}
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
                    {(extras > 0 || (edicao && "personalizado" in edicao && edicao.pasta === cat.id)) && (
                      <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted">Personalizados desta pasta</p>
                    )}
                    {blocoPersonalizados(cat.id, null)}
                  </div>
                )}
              </section>
            );
          })}

          <section className="rounded-card bg-surface shadow-card">
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
                {(personalizadosPorPasta.get("") ?? []).length} documento(s)
              </span>
            </button>
            {abertas.has("outros") && (
              <div className="border-t border-border px-4">{blocoPersonalizados("", "Nenhum documento personalizado ainda.")}</div>
            )}
          </section>
        </div>
      )}
    </PaginaConteudo>
  );
}
