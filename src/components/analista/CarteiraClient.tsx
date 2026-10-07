"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, LogIn, X, Info, PowerOff, Power } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, TextInput, TextArea, Select } from "@/components/ui/Field";
import { SegmentoLicitaNetSelect } from "@/components/empresa/SegmentoLicitaNetSelect";
import { LogoUpload } from "@/components/empresa/LogoUpload";
import { KeywordsInput } from "@/components/empresa/KeywordsInput";
import { buscarEnderecoPorCep } from "@/lib/cep";
import { formatBRL } from "@/lib/format";

type ClienteCarteira = {
  id: string;
  companyId: string;
  ativo: boolean;
  desativadoEm: string | null;
  company: { id: string; razaoSocial: string; cnpj: string; cidade: string; uf: string };
  pendencias: string[];
  plano: { id: string; nome: string; precoMensal: number } | null;
};

type PlanoCliente = { id: string; nome: string; precoMensal: number };

type Plano = { nome: string; maxEmpresas: number | null; precoMensal: number } | null;

type Cobranca = {
  clientesAtivos: number;
  totalMensalCheio: number;
  faturaPrevistaDoMes: number;
};

// Só estes quatro são obrigatórios — todo o resto pode ser completado depois (a carteira
// mostra o que ainda está pendente de cada cliente).
const CAMPOS_BASICOS = [
  ["razaoSocial", "Razão social", "text"],
  ["cnpj", "CNPJ", "text"],
  ["emailCliente", "E-mail de login do cliente", "email"],
  ["senhaCliente", "Senha de login do cliente", "password"],
] as const;

const CAMPOS_OPCIONAIS = [
  ["logradouro", "Logradouro"],
  ["numero", "Número"],
  ["complemento", "Complemento"],
  ["bairro", "Bairro"],
  ["cidade", "Cidade"],
  ["uf", "UF"],
  ["cep", "CEP"],
  ["banco", "Banco"],
  ["agencia", "Agência"],
  ["conta", "Conta"],
  ["socioNome", "Nome do responsável legal"],
  ["socioCpf", "CPF do responsável legal"],
] as const;

type ChaveBasica = (typeof CAMPOS_BASICOS)[number][0];
type ChaveOpcional = (typeof CAMPOS_OPCIONAIS)[number][0];
type FormState = Record<ChaveBasica | ChaveOpcional | "objetoSocial", string>;

const FORM_VAZIO = Object.fromEntries(
  [...CAMPOS_BASICOS.map(([k]) => k), ...CAMPOS_OPCIONAIS.map(([k]) => k), "objetoSocial"].map((k) => [k, ""])
) as FormState;

export function CarteiraClient() {
  const router = useRouter();
  const [carteira, setCarteira] = useState<ClienteCarteira[]>([]);
  const [plano, setPlano] = useState<Plano>(null);
  const [cobranca, setCobranca] = useState<Cobranca | null>(null);
  const [planosDisponiveis, setPlanosDisponiveis] = useState<PlanoCliente[]>([]);
  const [planoId, setPlanoId] = useState("");
  const [loading, setLoading] = useState(true);
  const [criando, setCriando] = useState(false);
  const [form, setForm] = useState<FormState>(FORM_VAZIO);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [segmentoId, setSegmentoId] = useState<number | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [buscandoCep, setBuscandoCep] = useState(false);
  const [entrandoId, setEntrandoId] = useState<string | null>(null);
  const [alterandoId, setAlterandoId] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/analista/carteira");
    const data = await res.json();
    setCarteira(data.carteira ?? []);
    setPlano(data.plano ?? null);
    setCobranca(data.cobranca ?? null);
    setPlanosDisponiveis(data.planosDisponiveis ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- busca inicial ao montar a tela
    load();
  }, [load]);

  function set(key: keyof FormState, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function setCep(value: string) {
    set("cep", value);
    if (value.replace(/\D/g, "").length !== 8) return;
    setBuscandoCep(true);
    buscarEnderecoPorCep(value.replace(/\D/g, ""))
      .then((e) => {
        if (!e) return;
        setForm((f) => ({
          ...f,
          logradouro: e.logradouro || f.logradouro,
          bairro: e.bairro || f.bairro,
          cidade: e.cidade || f.cidade,
          uf: e.uf || f.uf,
        }));
      })
      .finally(() => setBuscandoCep(false));
  }

  function fechar() {
    setCriando(false);
    setForm(FORM_VAZIO);
    setLogoUrl(null);
    setKeywords([]);
    setSegmentoId(null);
    setPlanoId("");
    setErro(null);
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);

    // Aviso antes de confirmar: o plano escolhido é cobrado todo mês direto do cliente.
    const escolhido = planosDisponiveis.find((pl) => pl.id === planoId);
    if (escolhido) {
      const ok = window.confirm(
        `O plano "${escolhido.nome}" (${formatBRL(escolhido.precoMensal)}/mês) será cobrado mensalmente direto deste cliente, proporcional aos dias no mês em que entrar ou sair.\n\nDeseja continuar?`
      );
      if (!ok) return;
    }

    setSalvando(true);
    try {
      // Campos opcionais em branco nem vão no pedido; a senha só vai neste envio e nunca é
      // guardada na tela depois.
      const corpo: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(form)) if (v.trim() !== "") corpo[k] = v.trim();
      if (logoUrl) corpo.logoUrl = logoUrl;
      if (keywords.length > 0) corpo.keywords = keywords;
      corpo.licitanetSegmentoId = segmentoId;
      if (planoId) corpo.planId = planoId;

      const res = await fetch("/api/analista/carteira", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      });
      const data = await res.json();
      if (!res.ok) {
        setErro(data.error ?? "Não foi possível adicionar o cliente");
        return;
      }
      fechar();
      setAviso(
        data.buscaIniciada
          ? "Cliente adicionado. O Agente Comercial já começou a buscar editais para ele."
          : "Cliente adicionado. Preencha as palavras-chave ou o segmento do LicitaNet para o Agente Comercial começar a buscar."
      );
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

  async function trocarPlano(c: ClienteCarteira, novoPlanoId: string) {
    if (!novoPlanoId || novoPlanoId === c.plano?.id) return;
    setAlterandoId(c.companyId);
    try {
      const res = await fetch(`/api/analista/carteira/${c.companyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acao: "plano", planId: novoPlanoId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        alert(data?.error ?? "Não foi possível trocar o plano");
        return;
      }
      await load();
    } finally {
      setAlterandoId(null);
    }
  }

  async function alterarAtivo(c: ClienteCarteira, acao: "desativar" | "reativar") {
    if (acao === "desativar") {
      const ok = window.confirm(
        `Desativar ${c.company.razaoSocial}?\n\nA cobrança mensal deste cliente para (proporcional aos dias deste mês) e você deixa de entrar na conta dele. Nada é apagado — dá para reativar depois.`
      );
      if (!ok) return;
    }
    setAlterandoId(c.companyId);
    try {
      const res = await fetch(`/api/analista/carteira/${c.companyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acao }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        alert(data?.error ?? "Não foi possível alterar o cliente");
        return;
      }
      await load();
    } finally {
      setAlterandoId(null);
    }
  }

  const ativos = carteira.filter((c) => c.ativo);
  const desativados = carteira.filter((c) => !c.ativo);
  const noLimite = plano?.maxEmpresas != null && ativos.length >= plano.maxEmpresas;

  return (
    <div className="mx-auto max-w-[1000px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Minha carteira</h1>
          <p className="mt-1 text-sm text-muted">
            {plano ? `Plano ${plano.nome}` : "Sem plano atribuído"} · {ativos.length}
            {plano?.maxEmpresas != null ? ` de ${plano.maxEmpresas}` : ""} cliente(s)
          </p>
        </div>
        {!criando && (
          <Button
            onClick={() => {
              setAviso(null);
              setCriando(true);
            }}
            disabled={noLimite}
            title={noLimite ? "Carteira no limite do plano" : undefined}
          >
            <Plus className="h-4 w-4" /> Adicionar cliente
          </Button>
        )}
      </div>

      {cobranca && (
        <div className="mt-4 rounded-xl border border-border bg-surface/50 p-4 text-sm">
          <p className="font-medium text-foreground">Planos mensais dos clientes</p>
          {cobranca.totalMensalCheio > 0 ? (
            <>
              <p className="mt-1 text-foreground">
                {cobranca.clientesAtivos} cliente(s) ativo(s) · <strong>{formatBRL(cobranca.totalMensalCheio)}/mês</strong>{" "}
                em planos
              </p>
              <p className="mt-1 text-xs text-muted">
                O valor de cada plano é cobrado mensalmente direto de cada cliente. Previsto para este mês (já
                proporcional a quem entrou ou saiu no meio do mês): {formatBRL(cobranca.faturaPrevistaDoMes)}.
              </p>
            </>
          ) : (
            <p className="mt-1 text-xs text-muted">
              {cobranca.clientesAtivos} cliente(s) ativo(s), nenhum com plano mensal definido ainda. O valor de cada
              plano é cobrado mensalmente direto do cliente.
            </p>
          )}
        </div>
      )}

      {aviso && (
        <p className="mt-4 flex items-start gap-2 rounded-lg border border-accent/30 bg-accent/5 px-4 py-2.5 text-sm text-accent">
          <Info className="mt-0.5 h-4 w-4 shrink-0" /> {aviso}
        </p>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-24 text-muted">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {criando && (
            <form onSubmit={salvar} className="rounded-xl border border-brand/30 bg-brand-light/20 p-4 sm:p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-foreground">Novo cliente</h2>
                <button type="button" onClick={fechar} className="text-muted hover:text-foreground">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <p className="mt-1 text-xs text-muted">
                Só os quatro primeiros campos são obrigatórios. O resto pode ser completado depois — a carteira mostra
                o que ainda está pendente.
              </p>

              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                {CAMPOS_BASICOS.map(([key, label, tipo]) => (
                  <Field key={key} label={`${label} *`} htmlFor={key}>
                    <TextInput
                      id={key}
                      required
                      type={tipo}
                      autoComplete={key === "senhaCliente" ? "new-password" : undefined}
                      value={form[key]}
                      onChange={(e) => set(key, e.target.value)}
                    />
                  </Field>
                ))}
              </div>

              <div className="mt-4">
                <Field
                  label={planosDisponiveis.length > 0 ? "Plano mensal *" : "Plano mensal"}
                  htmlFor="planoMensal"
                  hint="O valor do plano é cobrado mensalmente direto do cliente. Os planos são definidos pelo Bidd.IA."
                >
                  <Select
                    id="planoMensal"
                    required={planosDisponiveis.length > 0}
                    disabled={planosDisponiveis.length === 0}
                    value={planoId}
                    onChange={(e) => setPlanoId(e.target.value)}
                  >
                    <option value="">
                      {planosDisponiveis.length > 0 ? "Selecione o plano" : "Nenhum plano disponível no momento"}
                    </option>
                    {planosDisponiveis.map((pl) => (
                      <option key={pl.id} value={pl.id}>
                        {pl.nome} — {formatBRL(pl.precoMensal)}/mês
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>

              <div className="mt-6 border-t border-border pt-5">
                <p className="text-sm font-medium text-foreground">Busca de editais (opcional)</p>
                <p className="mt-1 text-xs text-muted">
                  Com palavras-chave ou segmento informados, o Agente Comercial já começa a buscar editais logo após o
                  cadastro.
                </p>
                <div className="mt-3">
                  <p className="text-sm font-medium text-foreground">Palavras-chave de pesquisa (PNCP)</p>
                  <KeywordsInput
                    items={keywords.map((k) => ({ key: k, term: k }))}
                    onAdd={(term) => {
                      const t = term.trim().toLowerCase();
                      if (t.length < 2) return false;
                      if (keywords.includes(t)) return false;
                      setKeywords((ks) => [...ks, t]);
                      return true;
                    }}
                    onRemove={(k) => setKeywords((ks) => ks.filter((x) => x !== k))}
                  />
                </div>
                <div className="mt-4">
                  <Field
                    label="Segmento no LicitaNet (opcional)"
                    htmlFor="segmentoCliente"
                    hint="Além do PNCP, o Agente Comercial também busca no LicitaNet, filtrando por este segmento."
                  >
                    <SegmentoLicitaNetSelect id="segmentoCliente" value={segmentoId} onChange={setSegmentoId} />
                  </Field>
                </div>
              </div>

              <div className="mt-6 border-t border-border pt-5">
                <p className="text-sm font-medium text-foreground">Dados da empresa (opcionais, podem ficar para depois)</p>
                <div className="mt-3">
                  <LogoUpload value={logoUrl} onChange={setLogoUrl} />
                </div>
                <div className="mt-4">
                  <Field label="Objeto da empresa" htmlFor="objetoSocial" hint="Ajuda o Agente Comercial a separar os editais relevantes.">
                    <TextArea
                      id="objetoSocial"
                      rows={2}
                      value={form.objetoSocial}
                      onChange={(e) => set("objetoSocial", e.target.value)}
                    />
                  </Field>
                </div>
                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
                  {CAMPOS_OPCIONAIS.map(([key, label]) => (
                    <Field
                      key={key}
                      label={label}
                      htmlFor={key}
                      hint={key === "cep" && buscandoCep ? "Buscando endereço..." : undefined}
                    >
                      <TextInput
                        id={key}
                        value={form[key]}
                        onChange={(e) => (key === "cep" ? setCep(e.target.value) : set(key, key === "uf" ? e.target.value.toUpperCase() : e.target.value))}
                        maxLength={key === "uf" ? 2 : undefined}
                      />
                    </Field>
                  ))}
                </div>
              </div>

              {erro && <p className="mt-4 text-sm text-danger">{erro}</p>}

              <div className="mt-5 flex flex-wrap items-center gap-2">
                <Button type="submit" loading={salvando}>
                  Adicionar cliente
                </Button>
                <Button type="button" variant="secondary" onClick={fechar}>
                  Cancelar
                </Button>
              </div>
            </form>
          )}

          {ativos.map((c) => (
            <div
              key={c.id}
              className="flex flex-col gap-3 rounded-xl border border-border bg-surface/50 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">{c.company.razaoSocial}</p>
                <p className="mt-0.5 text-xs text-muted">
                  CNPJ {c.company.cnpj}
                  {c.company.cidade && ` · ${c.company.cidade}${c.company.uf ? `/${c.company.uf}` : ""}`}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted">Plano mensal:</span>
                  {planosDisponiveis.length > 0 ? (
                    <select
                      aria-label={`Plano mensal de ${c.company.razaoSocial}`}
                      value={c.plano?.id ?? ""}
                      disabled={alterandoId === c.companyId}
                      onChange={(e) => trocarPlano(c, e.target.value)}
                      className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground focus:border-brand focus:outline-none"
                    >
                      {!c.plano && <option value="">Sem plano — escolha</option>}
                      {c.plano && !planosDisponiveis.some((pl) => pl.id === c.plano!.id) && (
                        <option value={c.plano.id}>
                          {c.plano.nome} — {formatBRL(c.plano.precoMensal)}/mês
                        </option>
                      )}
                      {planosDisponiveis.map((pl) => (
                        <option key={pl.id} value={pl.id}>
                          {pl.nome} — {formatBRL(pl.precoMensal)}/mês
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-xs text-foreground">
                      {c.plano ? `${c.plano.nome} — ${formatBRL(c.plano.precoMensal)}/mês` : "Sem plano"}
                    </span>
                  )}
                </div>
                {c.pendencias.length > 0 ? (
                  <p className="mt-2 text-xs text-warning">
                    <span className="font-medium">Pendente:</span> {c.pendencias.join(" · ")}
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-accent">Cadastro completo</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button variant="secondary" loading={entrandoId === c.companyId} onClick={() => entrar(c.companyId)}>
                  <LogIn className="h-3.5 w-3.5" /> {c.pendencias.length > 0 ? "Entrar e completar" : "Entrar"}
                </Button>
                <Button
                  variant="secondary"
                  loading={alterandoId === c.companyId}
                  onClick={() => alterarAtivo(c, "desativar")}
                  title="Para a cobrança mensal deste cliente"
                >
                  <PowerOff className="h-3.5 w-3.5" /> Desativar
                </Button>
              </div>
            </div>
          ))}

          {ativos.length === 0 && !criando && (
            <div className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted">
              Nenhum cliente na carteira ainda.
            </div>
          )}

          {desativados.length > 0 && (
            <div className="pt-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">Desativados (sem cobrança)</p>
              <div className="mt-2 space-y-2">
                {desativados.map((c) => (
                  <div
                    key={c.id}
                    className="flex flex-col gap-2 rounded-xl border border-dashed border-border p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-muted">{c.company.razaoSocial}</p>
                      {c.desativadoEm && (
                        <p className="text-xs text-muted">
                          Desativado em {new Date(c.desativadoEm).toLocaleDateString("pt-BR")}
                        </p>
                      )}
                    </div>
                    <Button
                      variant="secondary"
                      loading={alterandoId === c.companyId}
                      onClick={() => alterarAtivo(c, "reativar")}
                      disabled={noLimite}
                      title={noLimite ? "Carteira no limite do plano" : undefined}
                    >
                      <Power className="h-3.5 w-3.5" /> Reativar
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
