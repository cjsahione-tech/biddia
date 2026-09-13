"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { X, Upload, Check, Loader2 } from "lucide-react";
import { Field, TextInput, TextArea } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { buscarEnderecoPorCep } from "@/lib/cep";

const UF_LIST = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG",
  "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
];

type FormState = {
  objetoSocial: string;
  razaoSocial: string;
  cnpj: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
  cep: string;
  banco: string;
  agencia: string;
  conta: string;
  socioNome: string;
  socioCpf: string;
};

const EMPTY: FormState = {
  objetoSocial: "",
  razaoSocial: "",
  cnpj: "",
  logradouro: "",
  numero: "",
  complemento: "",
  bairro: "",
  cidade: "",
  uf: "",
  cep: "",
  banco: "",
  agencia: "",
  conta: "",
  socioNome: "",
  socioCpf: "",
};

export function OnboardingWizard() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [atendeServico, setAtendeServico] = useState(true);
  const [atendeBem, setAtendeBem] = useState(true);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [keywordDraft, setKeywordDraft] = useState("");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [buscandoCep, setBuscandoCep] = useState(false);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function setCep(value: string) {
    set("cep", value);
    // Liga o indicador de "buscando" já no evento de digitação (não dentro do efeito, que
    // deve só reagir a mudanças já commitadas) assim que o CEP completar 8 dígitos.
    if (value.replace(/\D/g, "").length === 8) setBuscandoCep(true);
  }

  // Assim que o CEP tiver os 8 dígitos, busca o endereço na ViaCEP e preenche
  // logradouro/bairro/cidade/UF automaticamente — o usuário ainda pode corrigir à mão.
  useEffect(() => {
    const digitos = form.cep.replace(/\D/g, "");
    if (digitos.length !== 8) return;

    let cancelado = false;
    buscarEnderecoPorCep(digitos)
      .then((endereco) => {
        if (cancelado || !endereco) return;
        setForm((f) => ({
          ...f,
          logradouro: endereco.logradouro || f.logradouro,
          bairro: endereco.bairro || f.bairro,
          cidade: endereco.cidade || f.cidade,
          uf: endereco.uf || f.uf,
        }));
      })
      .finally(() => {
        if (!cancelado) setBuscandoCep(false);
      });
    return () => {
      cancelado = true;
    };
  }, [form.cep]);

  function addKeyword() {
    const term = keywordDraft.trim();
    if (!term) return;
    if (!keywords.includes(term.toLowerCase())) {
      setKeywords((k) => [...k, term.toLowerCase()]);
    }
    setKeywordDraft("");
  }

  function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setLogoUrl(reader.result as string);
    reader.readAsDataURL(file);
  }

  function goToStep2(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.objetoSocial.trim()) {
      setError("Descreva o objeto da empresa para continuar.");
      return;
    }
    if (keywords.length === 0) {
      setError("Adicione ao menos uma palavra-chave de pesquisa.");
      return;
    }
    if (!atendeServico && !atendeBem) {
      setError("Selecione ao menos um tipo de atuação: serviço ou venda de bem/insumo.");
      return;
    }
    setStep(2);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/company", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, keywords, logoUrl, atendeServico, atendeBem }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Não foi possível salvar os dados da empresa");
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-8">
      <ol className="mb-8 flex items-center gap-4 text-sm">
        {["Objetivo & palavras-chave", "Dados da empresa"].map((label, i) => {
          const n = i + 1;
          const active = step === n;
          const done = step > n;
          return (
            <li key={label} className="flex items-center gap-2">
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                  done
                    ? "bg-brand text-white"
                    : active
                      ? "border-2 border-brand text-brand"
                      : "border border-border text-muted"
                }`}
              >
                {done ? <Check className="h-3.5 w-3.5" /> : n}
              </span>
              <span className={active || done ? "text-foreground" : "text-muted"}>{label}</span>
            </li>
          );
        })}
      </ol>

      {step === 1 && (
        <form onSubmit={goToStep2} className="space-y-5">
          <Field
            label="Qual é o objeto da sua empresa?"
            htmlFor="objetoSocial"
            hint="Descreva em poucas frases o que a empresa faz — isso ajuda os agentes a entender o contexto de cada edital."
          >
            <TextArea
              id="objetoSocial"
              rows={4}
              value={form.objetoSocial}
              onChange={(e) => set("objetoSocial", e.target.value)}
              placeholder="Ex: Fornecimento de equipamentos de informática e prestação de serviços de manutenção de TI."
            />
          </Field>

          <Field
            label="Tipo de atuação"
            htmlFor="atendeServico"
            hint="Usado pelos agentes para sinalizar editais fora do seu perfil, evitando que você avalie licitações que não fazem sentido para a sua qualificação."
          >
            <div className="mt-1.5 flex flex-col gap-2 sm:flex-row sm:gap-4">
              <label className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-foreground">
                <input
                  id="atendeServico"
                  type="checkbox"
                  checked={atendeServico}
                  onChange={(e) => setAtendeServico(e.target.checked)}
                  className="h-4 w-4 accent-brand"
                />
                Presto serviços
              </label>
              <label className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-foreground">
                <input
                  id="atendeBem"
                  type="checkbox"
                  checked={atendeBem}
                  onChange={(e) => setAtendeBem(e.target.checked)}
                  className="h-4 w-4 accent-brand"
                />
                Vendo bens/insumos
              </label>
            </div>
          </Field>

          <Field
            label="Palavras-chave de pesquisa"
            htmlFor="keyword"
            hint="O Agente Comercial usará estes termos para buscar editais nos portais de licitação. Pressione Enter para adicionar."
          >
            <div className="mt-1.5 flex gap-2">
              <TextInput
                id="keyword"
                value={keywordDraft}
                onChange={(e) => setKeywordDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addKeyword();
                  }
                }}
                placeholder="Ex: informática, material de escritório..."
                className="mt-0"
              />
              <Button type="button" variant="secondary" onClick={addKeyword}>
                Adicionar
              </Button>
            </div>
            {keywords.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {keywords.map((k) => (
                  <span
                    key={k}
                    className="inline-flex items-center gap-1.5 rounded-full bg-brand-light px-3 py-1 text-xs font-medium text-brand"
                  >
                    {k}
                    <button
                      type="button"
                      onClick={() => setKeywords((prev) => prev.filter((t) => t !== k))}
                      className="text-brand/60 hover:text-brand"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </Field>

          {error && <p className="text-sm text-danger">{error}</p>}

          <Button type="submit" className="w-full">
            Continuar
          </Button>
        </form>
      )}

      {step === 2 && (
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-dashed border-border bg-surface text-muted hover:border-brand hover:text-brand"
            >
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoUrl} alt="Logo da empresa" className="h-full w-full object-contain" />
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

          <div className="grid grid-cols-2 gap-4">
            <Field label="Razão social" htmlFor="razaoSocial">
              <TextInput
                id="razaoSocial"
                required
                value={form.razaoSocial}
                onChange={(e) => set("razaoSocial", e.target.value)}
              />
            </Field>
            <Field label="CNPJ" htmlFor="cnpj">
              <TextInput
                id="cnpj"
                required
                value={form.cnpj}
                onChange={(e) => set("cnpj", e.target.value)}
                placeholder="00.000.000/0000-00"
              />
            </Field>
          </div>

          <p className="text-sm font-medium text-foreground">Endereço completo</p>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Logradouro" htmlFor="logradouro">
              <TextInput
                id="logradouro"
                required
                value={form.logradouro}
                onChange={(e) => set("logradouro", e.target.value)}
              />
            </Field>
            <Field label="Número" htmlFor="numero">
              <TextInput
                id="numero"
                required
                value={form.numero}
                onChange={(e) => set("numero", e.target.value)}
              />
            </Field>
            <Field label="Complemento" htmlFor="complemento">
              <TextInput
                id="complemento"
                value={form.complemento}
                onChange={(e) => set("complemento", e.target.value)}
              />
            </Field>
          </div>
          <div className="grid grid-cols-4 gap-4">
            <Field label="Bairro" htmlFor="bairro">
              <TextInput
                id="bairro"
                required
                value={form.bairro}
                onChange={(e) => set("bairro", e.target.value)}
              />
            </Field>
            <Field label="Cidade" htmlFor="cidade">
              <TextInput
                id="cidade"
                required
                value={form.cidade}
                onChange={(e) => set("cidade", e.target.value)}
              />
            </Field>
            <Field label="UF" htmlFor="uf">
              <select
                id="uf"
                required
                value={form.uf}
                onChange={(e) => set("uf", e.target.value)}
                className="mt-1.5 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
              >
                <option value="">--</option>
                {UF_LIST.map((uf) => (
                  <option key={uf} value={uf}>
                    {uf}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="CEP" htmlFor="cep" hint={buscandoCep ? "Buscando endereço..." : undefined}>
              <div className="relative">
                <TextInput
                  id="cep"
                  required
                  value={form.cep}
                  onChange={(e) => setCep(e.target.value)}
                  placeholder="00000-000"
                />
                {buscandoCep && (
                  <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted" />
                )}
              </div>
            </Field>
          </div>

          <p className="text-sm font-medium text-foreground">Dados bancários</p>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Banco" htmlFor="banco">
              <TextInput
                id="banco"
                required
                value={form.banco}
                onChange={(e) => set("banco", e.target.value)}
              />
            </Field>
            <Field label="Agência" htmlFor="agencia">
              <TextInput
                id="agencia"
                required
                value={form.agencia}
                onChange={(e) => set("agencia", e.target.value)}
              />
            </Field>
            <Field label="Conta" htmlFor="conta">
              <TextInput
                id="conta"
                required
                value={form.conta}
                onChange={(e) => set("conta", e.target.value)}
              />
            </Field>
          </div>

          <p className="text-sm font-medium text-foreground">Sócio e responsável legal</p>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Nome completo" htmlFor="socioNome">
              <TextInput
                id="socioNome"
                required
                value={form.socioNome}
                onChange={(e) => set("socioNome", e.target.value)}
              />
            </Field>
            <Field label="CPF" htmlFor="socioCpf">
              <TextInput
                id="socioCpf"
                required
                value={form.socioCpf}
                onChange={(e) => set("socioCpf", e.target.value)}
                placeholder="000.000.000-00"
              />
            </Field>
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}

          <div className="flex gap-3">
            <Button type="button" variant="secondary" onClick={() => setStep(1)}>
              Voltar
            </Button>
            <Button type="submit" loading={loading} className="flex-1">
              Concluir cadastro
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
