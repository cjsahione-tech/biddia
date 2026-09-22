"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Field, TextInput } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Não foi possível entrar");
        return;
      }
      router.push("/dashboard");
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
        <h1 className="mt-6 text-2xl font-semibold text-foreground">Entrar na conta</h1>
        <p className="mt-1 text-sm text-muted">Acesse o painel da sua empresa.</p>

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
          <Field label="Senha" htmlFor="password">
            <TextInput
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </Field>

          {error && <p className="text-sm text-danger">{error}</p>}

          <div className="text-right">
            <Link href="/esqueci-senha" className="text-xs font-medium text-brand hover:underline">
              Esqueceu a senha?
            </Link>
          </div>

          <Button type="submit" loading={loading} className="w-full">
            Entrar
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-muted">
          Ainda não tem conta?{" "}
          <Link href="/registro" className="font-medium text-brand hover:underline">
            Criar conta
          </Link>
        </p>
      </div>
    </div>
  );
}
