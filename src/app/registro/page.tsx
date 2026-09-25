"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Field, TextInput, Select } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";

type TipoConta = "EMPRESA" | "ANALISTA";

export default function RegistroPage() {
  const router = useRouter();
  const [tipoConta, setTipoConta] = useState<TipoConta>("EMPRESA");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tipoDocumento, setTipoDocumento] = useState<"CPF" | "CNPJ">("CPF");
  const [documento, setDocumento] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const body =
        tipoConta === "EMPRESA"
          ? { tipoConta, name, email, password }
          : { tipoConta, name, email, password, tipoDocumentoAnalista: tipoDocumento, documentoAnalista: documento };

      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Não foi possível criar a conta");
        return;
      }
      router.push(tipoConta === "ANALISTA" ? "/carteira" : "/onboarding");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <Link href="/" className="text-lg font-semibold tracking-tight text-foreground">
          Bidd<span className="text-brand">.IA</span>
        </Link>
        <h1 className="mt-6 text-2xl font-semibold text-foreground">Criar conta</h1>
        <p className="mt-1 text-sm text-muted">Comece a montar sua equipe de agentes de IA.</p>

        <div className="mt-6 grid grid-cols-2 gap-2 rounded-lg border border-border bg-surface p-1">
          <button
            type="button"
            onClick={() => setTipoConta("EMPRESA")}
            className={`rounded-md px-3 py-2 text-sm font-medium transition ${
              tipoConta === "EMPRESA" ? "bg-brand text-white" : "text-muted hover:text-foreground"
            }`}
          >
            Sou uma Empresa
          </button>
          <button
            type="button"
            onClick={() => setTipoConta("ANALISTA")}
            className={`rounded-md px-3 py-2 text-sm font-medium transition ${
              tipoConta === "ANALISTA" ? "bg-brand text-white" : "text-muted hover:text-foreground"
            }`}
          >
            Sou Analista de Licitação
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <Field label="Nome completo" htmlFor="name">
            <TextInput
              id="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Seu nome"
            />
          </Field>
          <Field label="E-mail" htmlFor="email">
            <TextInput
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="voce@empresa.com"
            />
          </Field>
          <Field label="Senha" htmlFor="password" hint="Mínimo de 8 caracteres">
            <TextInput
              id="password"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </Field>

          {tipoConta === "ANALISTA" && (
            <div className="grid grid-cols-3 gap-3">
              <Field label="Documento" htmlFor="tipoDocumento">
                <Select
                  id="tipoDocumento"
                  value={tipoDocumento}
                  onChange={(e) => setTipoDocumento(e.target.value as "CPF" | "CNPJ")}
                >
                  <option value="CPF">CPF</option>
                  <option value="CNPJ">CNPJ</option>
                </Select>
              </Field>
              <div className="col-span-2">
                <Field label={tipoDocumento} htmlFor="documento">
                  <TextInput
                    id="documento"
                    required
                    value={documento}
                    onChange={(e) => setDocumento(e.target.value)}
                    placeholder={tipoDocumento === "CPF" ? "000.000.000-00" : "00.000.000/0000-00"}
                  />
                </Field>
              </div>
            </div>
          )}

          {error && <p className="text-sm text-danger">{error}</p>}

          <Button type="submit" loading={loading} className="w-full">
            Criar conta
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-muted">
          Já tem conta?{" "}
          <Link href="/login" className="font-medium text-brand hover:underline">
            Entrar
          </Link>
        </p>
      </div>
    </div>
  );
}
