"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Package, Wrench } from "lucide-react";
import { formatDateTime } from "@/lib/format";
import { RAMOS_ESTUDO, RAMO_LABEL, type RamoEstudo } from "@/lib/estudo-viabilidade";
import type { EstudoViabilidadeItem } from "@/lib/types";

const ICONE_RAMO: Record<RamoEstudo, typeof Wrench> = { SERVICO: Wrench, PRODUTO: Package };

/** Tela inicial do módulo (Etapa 0) — escolha do ramo, que grava um novo estudo e
 * determina os campos das etapas seguintes. Também lista estudos já iniciados. */
export function EstudoViabilidadeClient() {
  const router = useRouter();
  const [estudos, setEstudos] = useState<EstudoViabilidadeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [criando, setCriando] = useState<RamoEstudo | null>(null);

  useEffect(() => {
    fetch("/api/estudos")
      .then((r) => r.json())
      .then((data) => {
        if (data.estudos) setEstudos(data.estudos);
      })
      .finally(() => setLoading(false));
  }, []);

  async function criarEstudo(ramo: RamoEstudo) {
    if (criando) return;
    setCriando(ramo);
    try {
      const res = await fetch("/api/estudos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ramo }),
      });
      const data = await res.json();
      if (res.ok && data.estudo) router.push(`/estudo-viabilidade/${data.estudo.id}`);
    } finally {
      setCriando(null);
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <h1 className="text-2xl font-semibold text-foreground">Estudo de Viabilidade</h1>
      <p className="mt-1 text-sm text-muted">
        Simule se vale a pena participar de uma licitação: precificação, carga tributária e margem, item por item.
      </p>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {RAMOS_ESTUDO.map((r) => {
          const Icone = ICONE_RAMO[r.key];
          return (
            <button
              key={r.key}
              onClick={() => criarEstudo(r.key)}
              disabled={criando !== null}
              className="flex flex-col items-start gap-3 rounded-2xl border border-border bg-surface/50 p-6 text-left transition hover:border-brand hover:bg-brand-light/30 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-light text-brand">
                {criando === r.key ? <Loader2 className="h-5 w-5 animate-spin" /> : <Icone className="h-5 w-5" />}
              </div>
              <div>
                <h3 className="text-base font-semibold text-foreground">{r.label}</h3>
                <p className="mt-1 text-sm text-muted">{r.descricao}</p>
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-10">
        <h2 className="text-sm font-semibold text-foreground">Estudos anteriores</h2>

        {loading && (
          <div className="mt-4 flex justify-center py-8 text-muted">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}

        {!loading && estudos.length === 0 && (
          <p className="mt-3 text-sm text-muted">Nenhum estudo criado ainda.</p>
        )}

        {!loading && estudos.length > 0 && (
          <div className="mt-3 divide-y divide-border rounded-2xl border border-border">
            {estudos.map((e) => (
              <button
                key={e.id}
                onClick={() => router.push(`/estudo-viabilidade/${e.id}`)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-surface"
              >
                <span className="text-sm font-medium text-foreground">{RAMO_LABEL[e.ramo]}</span>
                <span className="text-xs text-muted">Atualizado em {formatDateTime(e.updatedAt)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
