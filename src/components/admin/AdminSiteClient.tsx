"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Image from "next/image";
import { Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, TextInput, TextArea } from "@/components/ui/Field";

type FormState = {
  heroTitulo: string;
  heroSubtitulo: string;
  heroImagemUrl: string | null;
  agentesSecaoTitulo: string;
  agentesSecaoDescricao: string;
  estudoSecaoTitulo: string;
  estudoSecaoDescricao: string;
};

const FORM_VAZIO: FormState = {
  heroTitulo: "",
  heroSubtitulo: "",
  heroImagemUrl: null,
  agentesSecaoTitulo: "",
  agentesSecaoDescricao: "",
  estudoSecaoTitulo: "",
  estudoSecaoDescricao: "",
};

export function AdminSiteClient() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<FormState>(FORM_VAZIO);
  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [enviandoImagem, setEnviandoImagem] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/site");
    const data = await res.json();
    if (data.content) setForm(data.content);
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- busca inicial ao montar a tela
    load();
  }, [load]);

  async function handleImagemSelecionada(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setErro(null);
    setEnviandoImagem(true);
    try {
      const urlRes = await fetch("/api/admin/site/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nomeArquivo: file.name, tamanhoBytes: file.size }),
      });
      const urlData = await urlRes.json();
      if (!urlRes.ok) {
        setErro(urlData.error ?? "Não foi possível preparar o upload.");
        return;
      }

      const putRes = await fetch(urlData.signedUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!putRes.ok) {
        setErro("Falha no upload da imagem. Tente novamente.");
        return;
      }

      setForm((f) => ({ ...f, heroImagemUrl: urlData.urlFinal }));
    } finally {
      setEnviandoImagem(false);
    }
  }

  async function salvar() {
    setSalvando(true);
    setErro(null);
    setSalvo(false);
    try {
      const res = await fetch("/api/admin/site", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setErro(data.error ?? "Não foi possível salvar");
        return;
      }
      setForm(data.content);
      setSalvo(true);
    } finally {
      setSalvando(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[800px] px-8 py-10">
      <h1 className="text-2xl font-semibold text-foreground">Conteúdo da home</h1>
      <p className="mt-1 text-sm text-muted">
        Edita o texto e a imagem do topo do site público — aparece assim que você salvar, sem precisar de deploy.
      </p>

      <div className="mt-6 space-y-5 rounded-xl border border-border bg-surface/50 p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Topo (hero)</p>
        <Field label="Título" htmlFor="heroTitulo">
          <TextInput id="heroTitulo" value={form.heroTitulo} onChange={(e) => setForm((f) => ({ ...f, heroTitulo: e.target.value }))} />
        </Field>
        <Field label="Subtítulo" htmlFor="heroSubtitulo">
          <TextArea
            id="heroSubtitulo"
            rows={3}
            value={form.heroSubtitulo}
            onChange={(e) => setForm((f) => ({ ...f, heroSubtitulo: e.target.value }))}
          />
        </Field>
        <div>
          <p className="text-sm font-medium text-foreground">Imagem</p>
          {form.heroImagemUrl && (
            <div className="relative mt-2 h-32 w-full overflow-hidden rounded-lg border border-border">
              <Image src={form.heroImagemUrl} alt="Imagem do topo" fill className="object-cover" unoptimized />
            </div>
          )}
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImagemSelecionada} />
          <Button
            type="button"
            variant="secondary"
            className="mt-2"
            loading={enviandoImagem}
            onClick={() => fileInputRef.current?.click()}
          >
            {!enviandoImagem && <Upload className="h-4 w-4" />}
            {form.heroImagemUrl ? "Trocar imagem" : "Enviar imagem"}
          </Button>
        </div>
      </div>

      <div className="mt-5 space-y-5 rounded-xl border border-border bg-surface/50 p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Seção &ldquo;6 agentes&rdquo;</p>
        <Field label="Título" htmlFor="agentesSecaoTitulo">
          <TextInput
            id="agentesSecaoTitulo"
            value={form.agentesSecaoTitulo}
            onChange={(e) => setForm((f) => ({ ...f, agentesSecaoTitulo: e.target.value }))}
          />
        </Field>
        <Field label="Descrição" htmlFor="agentesSecaoDescricao">
          <TextArea
            id="agentesSecaoDescricao"
            rows={2}
            value={form.agentesSecaoDescricao}
            onChange={(e) => setForm((f) => ({ ...f, agentesSecaoDescricao: e.target.value }))}
          />
        </Field>
      </div>

      <div className="mt-5 space-y-5 rounded-xl border border-border bg-surface/50 p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Seção &ldquo;Estudo de Viabilidade&rdquo;</p>
        <Field label="Título" htmlFor="estudoSecaoTitulo">
          <TextInput
            id="estudoSecaoTitulo"
            value={form.estudoSecaoTitulo}
            onChange={(e) => setForm((f) => ({ ...f, estudoSecaoTitulo: e.target.value }))}
          />
        </Field>
        <Field label="Descrição" htmlFor="estudoSecaoDescricao">
          <TextArea
            id="estudoSecaoDescricao"
            rows={2}
            value={form.estudoSecaoDescricao}
            onChange={(e) => setForm((f) => ({ ...f, estudoSecaoDescricao: e.target.value }))}
          />
        </Field>
      </div>

      {erro && <p className="mt-4 text-sm text-danger">{erro}</p>}
      {salvo && <p className="mt-4 text-sm text-emerald-600">Salvo — já está no ar.</p>}

      <div className="mt-5">
        <Button onClick={salvar} loading={salvando}>
          Salvar
        </Button>
      </div>
    </div>
  );
}
