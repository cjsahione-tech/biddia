"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, Upload, X, Check, Settings2 } from "lucide-react";
import { Field, TextInput, TextArea } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { REGIMES_TRIBUTARIOS, ANEXOS_SIMPLES, type RegimeTributario, type AnexoSimples } from "@/lib/tributos";

type Company = {
  objetoSocial: string;
  atendeServico: boolean;
  atendeBem: boolean;
  razaoSocial: string;
  cnpj: string;
  logradouro: string;
  numero: string;
  complemento: string | null;
  bairro: string;
  cidade: string;
  uf: string;
  cep: string;
  banco: string;
  agencia: string;
  conta: string;
  socioNome: string;
  socioCpf: string;
  logoUrl: string | null;
  regimeTributarioPadrao: RegimeTributario | null;
  anexoSimplesPadrao: AnexoSimples | null;
  rbt12Padrao: number | null;
  keywords: { id: string; term: string }[];
};

export function EmpresaClient() {
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keywordDraft, setKeywordDraft] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/company")
      .then((res) => res.json())
      .then((data) => {
        setCompany(data.company);
        setLoading(false);
      });
  }, []);

  function set<K extends keyof Company>(key: K, value: Company[K]) {
    setCompany((c) => (c ? { ...c, [key]: value } : c));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!company) return;
    setError(null);
    if (!company.atendeServico && !company.atendeBem) {
      setError("Selecione ao menos um tipo de atuação: serviço ou venda de bem/insumo.");
      return;
    }
    setSaving(true);
    setSaved(false);
    try {
      const { keywords, ...data } = company;
      void keywords;
      const res = await fetch("/api/company", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const body = await res.json().catch(() => null);
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
      } else {
        setError(body?.error ?? "Não foi possível salvar os dados da empresa");
      }
    } finally {
      setSaving(false);
    }
  }

  function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => set("logoUrl", reader.result as string);
    reader.readAsDataURL(file);
  }

  async function addKeyword() {
    const term = keywordDraft.trim();
    if (!term || !company) return;
    const res = await fetch("/api/keywords", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ term }),
    });
    const data = await res.json();
    if (res.ok) {
      setCompany((c) => (c ? { ...c, keywords: [...c.keywords, data.keyword] } : c));
      setKeywordDraft("");
    }
  }

  async function removeKeyword(id: string) {
    await fetch(`/api/keywords?id=${id}`, { method: "DELETE" });
    setCompany((c) => (c ? { ...c, keywords: c.keywords.filter((k) => k.id !== id) } : c));
  }

  if (loading || !company) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <h1 className="text-2xl font-semibold text-foreground">Empresa</h1>
      <p className="mt-1 text-sm text-muted">
        Estes dados alimentam os agentes — do timbrado dos documentos às buscas automáticas.
      </p>

      <section className="mt-8 rounded-2xl border border-border p-6">
        <h2 className="text-sm font-semibold text-foreground">Palavras-chave de pesquisa</h2>
        <p className="mt-1 text-xs text-muted">
          Usadas pelo Agente Comercial para buscar editais no PNCP.
        </p>
        <div className="mt-3 flex gap-2">
          <TextInput
            value={keywordDraft}
            onChange={(e) => setKeywordDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addKeyword();
              }
            }}
            placeholder="Nova palavra-chave"
            className="mt-0"
          />
          <Button type="button" variant="secondary" onClick={addKeyword}>
            Adicionar
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {company.keywords.map((k) => (
            <span
              key={k.id}
              className="inline-flex items-center gap-1.5 rounded-full bg-brand-light px-3 py-1 text-xs font-medium text-brand"
            >
              {k.term}
              <button onClick={() => removeKeyword(k.id)} className="text-brand/60 hover:text-brand">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          {company.keywords.length === 0 && (
            <p className="text-xs text-muted">Nenhuma palavra-chave cadastrada ainda.</p>
          )}
        </div>
      </section>

      <form onSubmit={handleSave} className="mt-6 space-y-6 rounded-2xl border border-border p-6">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-dashed border-border bg-surface text-muted hover:border-brand hover:text-brand"
          >
            {company.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={company.logoUrl} alt="Logo" className="h-full w-full object-contain" />
            ) : (
              <Upload className="h-5 w-5" />
            )}
          </button>
          <div>
            <p className="text-sm font-medium text-foreground">Logo da empresa</p>
            <p className="text-xs text-muted">Usada no timbrado dos documentos gerados.</p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg"
            className="hidden"
            onChange={handleLogoChange}
          />
        </div>

        <Field label="Objeto da empresa" htmlFor="objetoSocial">
          <TextArea
            id="objetoSocial"
            rows={3}
            value={company.objetoSocial}
            onChange={(e) => set("objetoSocial", e.target.value)}
          />
        </Field>

        <Field
          label="Tipo de atuação"
          htmlFor="atendeServico"
          hint="Usado pelos agentes para sinalizar editais fora do seu perfil."
        >
          <div className="mt-1.5 flex flex-col gap-2 sm:flex-row sm:gap-4">
            <label className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-foreground">
              <input
                id="atendeServico"
                type="checkbox"
                checked={company.atendeServico}
                onChange={(e) => set("atendeServico", e.target.checked)}
                className="h-4 w-4 accent-brand"
              />
              Presto serviços
            </label>
            <label className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-foreground">
              <input
                id="atendeBem"
                type="checkbox"
                checked={company.atendeBem}
                onChange={(e) => set("atendeBem", e.target.checked)}
                className="h-4 w-4 accent-brand"
              />
              Vendo bens/insumos
            </label>
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Razão social" htmlFor="razaoSocial">
            <TextInput
              id="razaoSocial"
              value={company.razaoSocial}
              onChange={(e) => set("razaoSocial", e.target.value)}
            />
          </Field>
          <Field label="CNPJ" htmlFor="cnpj">
            <TextInput id="cnpj" value={company.cnpj} onChange={(e) => set("cnpj", e.target.value)} />
          </Field>
        </div>

        <p className="text-sm font-medium text-foreground">Endereço completo</p>
        <div className="grid grid-cols-3 gap-4">
          <Field label="Logradouro" htmlFor="logradouro">
            <TextInput
              id="logradouro"
              value={company.logradouro}
              onChange={(e) => set("logradouro", e.target.value)}
            />
          </Field>
          <Field label="Número" htmlFor="numero">
            <TextInput id="numero" value={company.numero} onChange={(e) => set("numero", e.target.value)} />
          </Field>
          <Field label="Complemento" htmlFor="complemento">
            <TextInput
              id="complemento"
              value={company.complemento ?? ""}
              onChange={(e) => set("complemento", e.target.value)}
            />
          </Field>
        </div>
        <div className="grid grid-cols-4 gap-4">
          <Field label="Bairro" htmlFor="bairro">
            <TextInput id="bairro" value={company.bairro} onChange={(e) => set("bairro", e.target.value)} />
          </Field>
          <Field label="Cidade" htmlFor="cidade">
            <TextInput id="cidade" value={company.cidade} onChange={(e) => set("cidade", e.target.value)} />
          </Field>
          <Field label="UF" htmlFor="uf">
            <TextInput id="uf" value={company.uf} onChange={(e) => set("uf", e.target.value.toUpperCase())} />
          </Field>
          <Field label="CEP" htmlFor="cep">
            <TextInput id="cep" value={company.cep} onChange={(e) => set("cep", e.target.value)} />
          </Field>
        </div>

        <p className="text-sm font-medium text-foreground">Dados bancários</p>
        <div className="grid grid-cols-3 gap-4">
          <Field label="Banco" htmlFor="banco">
            <TextInput id="banco" value={company.banco} onChange={(e) => set("banco", e.target.value)} />
          </Field>
          <Field label="Agência" htmlFor="agencia">
            <TextInput id="agencia" value={company.agencia} onChange={(e) => set("agencia", e.target.value)} />
          </Field>
          <Field label="Conta" htmlFor="conta">
            <TextInput id="conta" value={company.conta} onChange={(e) => set("conta", e.target.value)} />
          </Field>
        </div>

        <p className="text-sm font-medium text-foreground">Sócio e responsável legal</p>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Nome completo" htmlFor="socioNome">
            <TextInput
              id="socioNome"
              value={company.socioNome}
              onChange={(e) => set("socioNome", e.target.value)}
            />
          </Field>
          <Field label="CPF" htmlFor="socioCpf">
            <TextInput id="socioCpf" value={company.socioCpf} onChange={(e) => set("socioCpf", e.target.value)} />
          </Field>
        </div>

        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-foreground">Regime tributário padrão</p>
          <Link
            href="/empresa/parametros-tributarios"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-brand hover:underline"
          >
            <Settings2 className="h-3.5 w-3.5" /> Parâmetros tributários
          </Link>
        </div>
        <p className="-mt-4 text-xs text-muted">
          Só pré-preenche um novo estudo de viabilidade — cada estudo pode usar outro regime para simulações, sem
          alterar este cadastro.
        </p>
        <div className="grid grid-cols-3 gap-4">
          <Field label="Regime" htmlFor="regimeTributarioPadrao">
            <select
              id="regimeTributarioPadrao"
              value={company.regimeTributarioPadrao ?? ""}
              onChange={(e) => set("regimeTributarioPadrao", (e.target.value || null) as RegimeTributario | null)}
              className="mt-1.5 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
            >
              <option value="">Não definido</option>
              {REGIMES_TRIBUTARIOS.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </select>
          </Field>
          {company.regimeTributarioPadrao === "SIMPLES_NACIONAL" && (
            <>
              <Field label="Anexo" htmlFor="anexoSimplesPadrao">
                <select
                  id="anexoSimplesPadrao"
                  value={company.anexoSimplesPadrao ?? ""}
                  onChange={(e) => set("anexoSimplesPadrao", (e.target.value || null) as AnexoSimples | null)}
                  className="mt-1.5 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                >
                  <option value="">Selecione</option>
                  {ANEXOS_SIMPLES.map((a) => (
                    <option key={a.key} value={a.key}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="RBT12 (R$)" htmlFor="rbt12Padrao" hint="Faturamento dos últimos 12 meses">
                <TextInput
                  id="rbt12Padrao"
                  type="number"
                  min={0}
                  step={0.01}
                  value={company.rbt12Padrao ?? ""}
                  onChange={(e) => set("rbt12Padrao", e.target.value ? Number(e.target.value) : null)}
                />
              </Field>
            </>
          )}
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="flex items-center gap-3">
          <Button type="submit" loading={saving}>
            Salvar alterações
          </Button>
          {saved && (
            <span className="inline-flex items-center gap-1.5 text-sm text-accent">
              <Check className="h-4 w-4" /> Salvo
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
