"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, LogIn, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, TextInput } from "@/components/ui/Field";
import { formatBRL } from "@/lib/format";

type ClienteCarteira = {
  id: string;
  companyId: string;
  tarifaMensal: number;
  company: { id: string; razaoSocial: string; cnpj: string; cidade: string; uf: string };
};

type Plano = { nome: string; maxEmpresas: number | null } | null;

const CAMPOS_OBRIGATORIOS = [
  ["razaoSocial", "Razão social"],
  ["cnpj", "CNPJ"],
  ["objetoSocial", "Objeto social"],
  ["logradouro", "Logradouro"],
  ["numero", "Número"],
  ["bairro", "Bairro"],
  ["cidade", "Cidade"],
  ["uf", "UF"],
  ["cep", "CEP"],
  ["banco", "Banco"],
  ["agencia", "Agência"],
  ["conta", "Conta"],
  ["socioNome", "Nome do responsável legal"],
  ["socioCpf", "CPF do responsável legal"],
  ["emailCliente", "E-mail de login do cliente"],
  ["senhaCliente", "Senha de login do cliente"],
  ["tarifaMensal", "Tarifa mensal cobrada deste cliente (R$)"],
] as const;

type FormKey = (typeof CAMPOS_OBRIGATORIOS)[number][0];
type FormState = Record<FormKey, string>;

const FORM_VAZIO = Object.fromEntries(CAMPOS_OBRIGATORIOS.map(([k]) => [k, ""])) as FormState;

export function CarteiraClient() {
  const router = useRouter();
  const [carteira, setCarteira] = useState<ClienteCarteira[]>([]);
  const [plano, setPlano] = useState<Plano>(null);
  const [loading, setLoading] = useState(true);
  const [criando, setCriando] = useState(false);
  const [form, setForm] = useState<FormState>(FORM_VAZIO);
  const [salvando, setSalvando] = useState(false);
  const [entrandoId, setEntrandoId] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/analista/carteira");
    const data = await res.json();
    setCarteira(data.carteira ?? []);
    setPlano(data.plano ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- busca inicial ao montar a tela
    load();
  }, [load]);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setSalvando(true);
    setErro(null);
    try {
      const res = await fetch("/api/analista/carteira", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, tarifaMensal: Number(form.tarifaMensal || 0) }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErro(data.error ?? "Não foi possível adicionar o cliente");
        return;
      }
      setCriando(false);
      setForm(FORM_VAZIO);
      await load();
    } finally {
      setSalvando(false);
    }
  }

  async function entrar(companyId: string) {
    setEntrandoId(companyId);
    try {
      const res = await fetch(`/api/analista/carteira/${companyId}/entrar`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        alert(data?.error ?? "Não foi possível entrar nesta empresa");
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } finally {
      setEntrandoId(null);
    }
  }

  const noLimite = plano?.maxEmpresas != null && carteira.length >= plano.maxEmpresas;

  return (
    <div className="mx-auto max-w-[1000px] px-8 py-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Minha carteira</h1>
          <p className="mt-1 text-sm text-muted">
            {plano ? `Plano ${plano.nome}` : "Sem plano atribuído"} ·{" "}
            {carteira.length}
            {plano?.maxEmpresas != null ? ` de ${plano.maxEmpresas}` : ""} cliente(s)
          </p>
        </div>
        {!criando && (
          <Button onClick={() => setCriando(true)} disabled={noLimite} title={noLimite ? "Carteira no limite do plano" : undefined}>
            <Plus className="h-4 w-4" /> Adicionar cliente
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24 text-muted">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {criando && (
            <form onSubmit={salvar} className="rounded-xl border border-brand/30 bg-brand-light/20 p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-foreground">Novo cliente</h2>
                <button type="button" onClick={() => setCriando(false)} className="text-muted hover:text-foreground">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
                {CAMPOS_OBRIGATORIOS.map(([key, label]) => (
                  <Field key={key} label={label} htmlFor={key}>
                    <TextInput
                      id={key}
                      required
                      type={key === "senhaCliente" ? "password" : key === "emailCliente" ? "email" : key === "tarifaMensal" ? "number" : "text"}
                      value={form[key]}
                      onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                    />
                  </Field>
                ))}
              </div>

              {erro && <p className="mt-4 text-sm text-danger">{erro}</p>}

              <div className="mt-5 flex items-center gap-2">
                <Button type="submit" loading={salvando}>
                  Adicionar
                </Button>
                <Button type="button" variant="secondary" onClick={() => setCriando(false)}>
                  Cancelar
                </Button>
              </div>
            </form>
          )}

          {carteira.map((c) => (
            <div key={c.id} className="flex items-center justify-between rounded-xl border border-border bg-surface/50 p-4">
              <div>
                <p className="text-sm font-semibold text-foreground">{c.company.razaoSocial}</p>
                <p className="mt-0.5 text-xs text-muted">
                  CNPJ {c.company.cnpj} · {c.company.cidade}/{c.company.uf} · {formatBRL(c.tarifaMensal)}/mês
                </p>
              </div>
              <Button variant="secondary" loading={entrandoId === c.companyId} onClick={() => entrar(c.companyId)}>
                <LogIn className="h-3.5 w-3.5" /> Entrar
              </Button>
            </div>
          ))}

          {carteira.length === 0 && !criando && (
            <div className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted">
              Nenhum cliente na carteira ainda.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
