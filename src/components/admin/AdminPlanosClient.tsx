"use client";

import { useEffect, useState, useCallback } from "react";
import { Loader2, Plus, Pencil, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, TextInput, Select } from "@/components/ui/Field";
import { formatBRL } from "@/lib/format";

type Feature = { id: string; chave: string; label: string; categoria: string };
type Plano = {
  id: string;
  nome: string;
  slug: string;
  publicoAlvo: "EMPRESA" | "ANALISTA";
  precoMensal: number;
  precoAnual: number | null;
  maxEditaisAtivos: number | null;
  maxAnalisesPorMes: number | null;
  maxEmpresas: number | null;
  maxUsuarios: number | null;
  ativo: boolean;
  ordemExibicao: number;
  features: { feature: Feature }[];
  _count: { companies: number };
};

type FormState = {
  nome: string;
  slug: string;
  publicoAlvo: "EMPRESA" | "ANALISTA";
  precoMensal: string;
  precoAnual: string;
  maxEditaisAtivos: string;
  maxAnalisesPorMes: string;
  maxEmpresas: string;
  maxUsuarios: string;
  ativo: boolean;
  ordemExibicao: string;
  featureIds: Set<string>;
};

const FORM_VAZIO: FormState = {
  nome: "",
  slug: "",
  publicoAlvo: "EMPRESA",
  precoMensal: "",
  precoAnual: "",
  maxEditaisAtivos: "",
  maxAnalisesPorMes: "",
  maxEmpresas: "",
  maxUsuarios: "",
  ativo: true,
  ordemExibicao: "0",
  featureIds: new Set(),
};

function planoParaForm(p: Plano): FormState {
  return {
    nome: p.nome,
    slug: p.slug,
    publicoAlvo: p.publicoAlvo,
    precoMensal: String(p.precoMensal),
    precoAnual: p.precoAnual != null ? String(p.precoAnual) : "",
    maxEditaisAtivos: p.maxEditaisAtivos != null ? String(p.maxEditaisAtivos) : "",
    maxAnalisesPorMes: p.maxAnalisesPorMes != null ? String(p.maxAnalisesPorMes) : "",
    maxEmpresas: p.maxEmpresas != null ? String(p.maxEmpresas) : "",
    maxUsuarios: p.maxUsuarios != null ? String(p.maxUsuarios) : "",
    ativo: p.ativo,
    ordemExibicao: String(p.ordemExibicao),
    featureIds: new Set(p.features.map((f) => f.feature.id)),
  };
}

// number|"" -> null (ilimitado) | number, pros campos de limite
function numOuNull(v: string): number | null {
  return v.trim() === "" ? null : Number(v);
}

export function AdminPlanosClient() {
  const [planos, setPlanos] = useState<Plano[]>([]);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [loading, setLoading] = useState(true);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const [form, setForm] = useState<FormState>(FORM_VAZIO);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [planosRes, featuresRes] = await Promise.all([
      fetch("/api/admin/planos"),
      fetch("/api/admin/features"),
    ]);
    const planosData = await planosRes.json();
    const featuresData = await featuresRes.json();
    setPlanos(planosData.planos ?? []);
    setFeatures(featuresData.features ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- busca inicial ao montar a tela
    load();
  }, [load]);

  function iniciarEdicao(p: Plano) {
    setCriando(false);
    setEditandoId(p.id);
    setForm(planoParaForm(p));
    setErro(null);
  }

  function iniciarCriacao() {
    setEditandoId(null);
    setCriando(true);
    setForm(FORM_VAZIO);
    setErro(null);
  }

  function cancelar() {
    setEditandoId(null);
    setCriando(false);
    setErro(null);
  }

  function alternarFeature(id: string) {
    setForm((f) => {
      const novo = new Set(f.featureIds);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return { ...f, featureIds: novo };
    });
  }

  async function salvar() {
    setSalvando(true);
    setErro(null);
    const payload = {
      nome: form.nome,
      slug: form.slug,
      publicoAlvo: form.publicoAlvo,
      precoMensal: Number(form.precoMensal || 0),
      precoAnual: numOuNull(form.precoAnual),
      maxEditaisAtivos: numOuNull(form.maxEditaisAtivos),
      maxAnalisesPorMes: numOuNull(form.maxAnalisesPorMes),
      maxEmpresas: numOuNull(form.maxEmpresas),
      maxUsuarios: numOuNull(form.maxUsuarios),
      ativo: form.ativo,
      ordemExibicao: Number(form.ordemExibicao || 0),
      featureIds: Array.from(form.featureIds),
    };
    try {
      const res = criando
        ? await fetch("/api/admin/planos", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch(`/api/admin/planos/${editandoId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      const data = await res.json();
      if (!res.ok) {
        setErro(data.error ?? "Não foi possível salvar");
        return;
      }
      cancelar();
      await load();
    } finally {
      setSalvando(false);
    }
  }

  async function excluir(id: string) {
    if (!confirm("Excluir este plano? Só é possível se nenhuma empresa estiver nele.")) return;
    const res = await fetch(`/api/admin/planos/${id}`, { method: "DELETE" });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      alert(data?.error ?? "Não foi possível excluir");
      return;
    }
    await load();
  }

  const categorias = Array.from(new Set(features.map((f) => f.categoria)));

  const formAtivo = criando || editandoId !== null;

  return (
    <div className="mx-auto max-w-[1100px] px-8 py-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Planos</h1>
          <p className="mt-1 text-sm text-muted">
            Limites, preços e features liberadas por plano — a seção de preços do site público lê direto daqui.
          </p>
        </div>
        {!formAtivo && (
          <Button onClick={iniciarCriacao}>
            <Plus className="h-4 w-4" /> Novo plano
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24 text-muted">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {formAtivo && (
            <div className="rounded-xl border border-brand/30 bg-brand-light/20 p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-foreground">
                  {criando ? "Novo plano" : `Editando: ${planos.find((p) => p.id === editandoId)?.nome}`}
                </h2>
                <button onClick={cancelar} className="text-muted hover:text-foreground">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
                <Field label="Nome" htmlFor="nome">
                  <TextInput id="nome" value={form.nome} onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))} />
                </Field>
                <Field label="Slug" htmlFor="slug">
                  <TextInput
                    id="slug"
                    value={form.slug}
                    disabled={!criando}
                    onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
                  />
                </Field>
                <Field label="Público-alvo" htmlFor="publicoAlvo">
                  <Select
                    id="publicoAlvo"
                    value={form.publicoAlvo}
                    onChange={(e) => setForm((f) => ({ ...f, publicoAlvo: e.target.value as "EMPRESA" | "ANALISTA" }))}
                  >
                    <option value="EMPRESA">Empresa</option>
                    <option value="ANALISTA">Analista de Licitação</option>
                  </Select>
                </Field>
                <Field label="Preço mensal (R$)" htmlFor="precoMensal">
                  <TextInput
                    id="precoMensal"
                    type="number"
                    min={0}
                    step="0.01"
                    value={form.precoMensal}
                    onChange={(e) => setForm((f) => ({ ...f, precoMensal: e.target.value }))}
                  />
                </Field>
                <Field label="Preço anual (R$)" htmlFor="precoAnual" hint="Opcional">
                  <TextInput
                    id="precoAnual"
                    type="number"
                    min={0}
                    step="0.01"
                    value={form.precoAnual}
                    onChange={(e) => setForm((f) => ({ ...f, precoAnual: e.target.value }))}
                  />
                </Field>
                <Field label="Ordem de exibição" htmlFor="ordemExibicao">
                  <TextInput
                    id="ordemExibicao"
                    type="number"
                    value={form.ordemExibicao}
                    onChange={(e) => setForm((f) => ({ ...f, ordemExibicao: e.target.value }))}
                  />
                </Field>
                <Field label="Máx. editais ativos" htmlFor="maxEditaisAtivos" hint="Vazio = ilimitado">
                  <TextInput
                    id="maxEditaisAtivos"
                    type="number"
                    min={0}
                    value={form.maxEditaisAtivos}
                    onChange={(e) => setForm((f) => ({ ...f, maxEditaisAtivos: e.target.value }))}
                  />
                </Field>
                <Field label="Máx. análises/mês" htmlFor="maxAnalisesPorMes" hint="Vazio = ilimitado">
                  <TextInput
                    id="maxAnalisesPorMes"
                    type="number"
                    min={0}
                    value={form.maxAnalisesPorMes}
                    onChange={(e) => setForm((f) => ({ ...f, maxAnalisesPorMes: e.target.value }))}
                  />
                </Field>
                <Field
                  label="Máx. empresas"
                  htmlFor="maxEmpresas"
                  hint={form.publicoAlvo === "ANALISTA" ? "Teto da carteira (aplicado)" : "Reservado, não aplicado"}
                >
                  <TextInput
                    id="maxEmpresas"
                    type="number"
                    min={0}
                    value={form.maxEmpresas}
                    onChange={(e) => setForm((f) => ({ ...f, maxEmpresas: e.target.value }))}
                  />
                </Field>
                <Field label="Máx. usuários" htmlFor="maxUsuarios" hint="Reservado, não aplicado">
                  <TextInput
                    id="maxUsuarios"
                    type="number"
                    min={0}
                    value={form.maxUsuarios}
                    onChange={(e) => setForm((f) => ({ ...f, maxUsuarios: e.target.value }))}
                  />
                </Field>
                <label className="mt-6 flex items-center gap-2 text-sm font-medium text-foreground">
                  <input
                    type="checkbox"
                    checked={form.ativo}
                    onChange={(e) => setForm((f) => ({ ...f, ativo: e.target.checked }))}
                    className="h-4 w-4 accent-brand"
                  />
                  Ativo (aparece na página de preços)
                </label>
              </div>

              <div className="mt-5">
                <p className="text-sm font-medium text-foreground">Features liberadas</p>
                <div className="mt-2 space-y-3">
                  {categorias.map((cat) => (
                    <div key={cat}>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{cat}</p>
                      <div className="mt-1 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                        {features
                          .filter((f) => f.categoria === cat)
                          .map((f) => (
                            <label key={f.id} className="flex items-center gap-2 text-sm text-foreground">
                              <input
                                type="checkbox"
                                checked={form.featureIds.has(f.id)}
                                onChange={() => alternarFeature(f.id)}
                                className="h-4 w-4 accent-brand"
                              />
                              {f.label}
                            </label>
                          ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {erro && <p className="mt-4 text-sm text-danger">{erro}</p>}

              <div className="mt-5 flex items-center gap-2">
                <Button onClick={salvar} loading={salvando}>
                  Salvar
                </Button>
                <Button variant="secondary" onClick={cancelar}>
                  Cancelar
                </Button>
              </div>
            </div>
          )}

          {planos.map((p) => (
            <div key={p.id} className="flex items-center justify-between rounded-xl border border-border bg-surface/50 p-4">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-foreground">{p.nome}</p>
                  <span className="rounded-full bg-surface px-1.5 py-0.5 text-[10px] font-medium text-muted">
                    {p.publicoAlvo === "EMPRESA" ? "Empresa" : "Analista"}
                  </span>
                  {!p.ativo && (
                    <span className="rounded-full bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-warning">Inativo</span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-muted">
                  {formatBRL(p.precoMensal)}/mês · {p._count.companies} empresa(s) neste plano · {p.features.length} feature(s)
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="secondary" onClick={() => iniciarEdicao(p)}>
                  <Pencil className="h-3.5 w-3.5" /> Editar
                </Button>
                <Button variant="danger" onClick={() => excluir(p.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
