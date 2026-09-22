"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Field, TextInput } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";

function RedefinirSenhaForm() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const [novaSenha, setNovaSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (novaSenha !== confirmacao) {
      setError("As senhas não coincidem");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, novaSenha }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Não foi possível redefinir a senha");
        return;
      }
      router.push("/login");
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <p className="mt-6 rounded-lg border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
        Link inválido. Solicite um novo em{" "}
        <Link href="/esqueci-senha" className="font-medium underline">
          Esqueci a senha
        </Link>
        .
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-8 space-y-4">
      <Field label="Nova senha" htmlFor="novaSenha">
        <TextInput
          id="novaSenha"
          type="password"
          required
          minLength={8}
          value={novaSenha}
          onChange={(e) => setNovaSenha(e.target.value)}
          placeholder="••••••••"
        />
      </Field>
      <Field label="Confirmar nova senha" htmlFor="confirmacao">
        <TextInput
          id="confirmacao"
          type="password"
          required
          minLength={8}
          value={confirmacao}
          onChange={(e) => setConfirmacao(e.target.value)}
          placeholder="••••••••"
        />
      </Field>

      {error && <p className="text-sm text-danger">{error}</p>}

      <Button type="submit" loading={loading} className="w-full">
        Redefinir senha
      </Button>
    </form>
  );
}

export default function RedefinirSenhaPage() {
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <Link href="/" className="text-lg font-semibold tracking-tight text-foreground">
          Bidd<span className="text-brand">.IA</span>
        </Link>
        <h1 className="mt-6 text-2xl font-semibold text-foreground">Redefinir senha</h1>
        <p className="mt-1 text-sm text-muted">O link enviado por SMS é válido por 15 minutos.</p>

        <Suspense fallback={null}>
          <RedefinirSenhaForm />
        </Suspense>
      </div>
    </div>
  );
}
