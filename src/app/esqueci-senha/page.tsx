"use client";

import { useState } from "react";
import Link from "next/link";
import { Field, TextInput } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";

export default function EsqueciSenhaPage() {
  const [email, setEmail] = useState("");
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      // A rota sempre devolve uma mensagem genérica, mesmo se o e-mail não existir —
      // não dá pra confirmar aqui se a conta existe ou não.
      setMensagem(data.message ?? "Se o e-mail informado tiver uma conta com número cadastrado, você vai receber um SMS.");
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
        <h1 className="mt-6 text-2xl font-semibold text-foreground">Esqueceu a senha?</h1>
        <p className="mt-1 text-sm text-muted">
          Informe o e-mail da sua conta — enviamos um link de redefinição por SMS pro número cadastrado da empresa.
        </p>

        {mensagem ? (
          <p className="mt-6 rounded-lg border border-border bg-surface px-4 py-3 text-sm text-foreground">
            {mensagem}
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="mt-8 space-y-4">
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
            <Button type="submit" loading={loading} className="w-full">
              Enviar link por SMS
            </Button>
          </form>
        )}

        <p className="mt-6 text-center text-sm text-muted">
          Lembrou a senha?{" "}
          <Link href="/login" className="font-medium text-brand hover:underline">
            Voltar para o login
          </Link>
        </p>
      </div>
    </div>
  );
}
