"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Field, TextInput } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";

export default function EsqueciSenhaPage() {
  const router = useRouter();
  const [etapa, setEtapa] = useState<"telefone" | "codigo">("telefone");
  const [telefone, setTelefone] = useState("");
  const [codigo, setCodigo] = useState("");
  const [novaSenha, setNovaSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handlePedirCodigo(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telefone }),
      });
      const data = await res.json();
      // A rota sempre devolve uma mensagem genérica, mesmo se o número não existir — não
      // dá pra confirmar aqui se a conta existe. Mesmo assim já avança pra etapa do
      // código: se o número não tiver conta, o próximo passo só vai dar "código inválido".
      setInfo(data.message ?? "Se esse número tiver uma conta, você vai receber um código por SMS em instantes.");
      setEtapa("codigo");
    } finally {
      setLoading(false);
    }
  }

  async function handleRedefinir(e: React.FormEvent) {
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
        body: JSON.stringify({ telefone, codigo, novaSenha }),
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

  return (
    <div className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <Link href="/" className="text-lg font-semibold tracking-tight text-foreground">
          Bidd<span className="text-brand">.IA</span>
        </Link>
        <h1 className="mt-6 text-2xl font-semibold text-foreground">Esqueceu a senha?</h1>
        <p className="mt-1 text-sm text-muted">
          {etapa === "telefone"
            ? "Informe o número de WhatsApp cadastrado da empresa — enviamos um código de 6 dígitos por SMS."
            : "Informe o código recebido por SMS e a nova senha."}
        </p>

        {info && etapa === "codigo" && (
          <p className="mt-4 rounded-lg border border-border bg-surface px-4 py-3 text-sm text-foreground">{info}</p>
        )}

        {etapa === "telefone" ? (
          <form onSubmit={handlePedirCodigo} className="mt-8 space-y-4">
            <Field label="Número de WhatsApp" htmlFor="telefone">
              <TextInput
                id="telefone"
                type="tel"
                required
                value={telefone}
                onChange={(e) => setTelefone(e.target.value)}
                placeholder="(11) 99999-9999"
              />
            </Field>
            <Button type="submit" loading={loading} className="w-full">
              Enviar código por SMS
            </Button>
          </form>
        ) : (
          <form onSubmit={handleRedefinir} className="mt-4 space-y-4">
            <Field label="Código recebido" htmlFor="codigo">
              <TextInput
                id="codigo"
                type="text"
                inputMode="numeric"
                required
                maxLength={6}
                value={codigo}
                onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ""))}
                placeholder="000000"
              />
            </Field>
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
            <button
              type="button"
              onClick={() => setEtapa("telefone")}
              className="w-full text-center text-xs text-muted hover:text-foreground"
            >
              Errou o número ou não recebeu o código? Voltar
            </button>
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
