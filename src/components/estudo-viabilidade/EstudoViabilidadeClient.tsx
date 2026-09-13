"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Package, Pencil, X, Wrench } from "lucide-react";
import { formatDateTime } from "@/lib/format";
import { RAMOS_ESTUDO, RAMO_LABEL, type RamoEstudo } from "@/lib/estudo-viabilidade";
import type { EstudoViabilidadeItem } from "@/lib/types";

const ICONE_RAMO: Record<RamoEstudo, typeof Wrench> = { SERVICO: Wrench, PRODUTO: Package };

/** Tela inicial do módulo (Etapa 0) — escolha do ramo, que grava um novo estudo e
 * determina os campos das etapas seguintes. Também lista estudos já iniciados, com nome
 * opcional (editável inline) para diferenciar estudos do mesmo ramo na listagem. */
export function EstudoViabilidadeClient() {
  const router = useRouter();
  const [estudos, setEstudos] = useState<EstudoViabilidadeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [criando, setCriando] = useState<RamoEstudo | null>(null);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [nomeEditado, setNomeEditado] = useState("");
  const [salvandoId, setSalvandoId] = useState<string | null>(null);

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

  function iniciarEdicao(e: EstudoViabilidadeItem) {
    setEditandoId(e.id);
    setNomeEditado(e.nome ?? "");
  }

  async function salvarNome(id: string) {
    setSalvandoId(id);
    try {
      const res = await fetch(`/api/estudos/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: nomeEditado.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.estudo) {
        setEstudos((prev) => prev.map((e) => (e.id === id ? { ...e, nome: data.estudo.nome } : e)));
        setEditandoId(null);
      }
    } finally {
      setSalvandoId(null);
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
            {estudos.map((e) => {
              const editando = editandoId === e.id;
              return (
                <div key={e.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  {editando ? (
                    <div className="flex flex-1 items-center gap-2">
                      <input
                        autoFocus
                        value={nomeEditado}
                        onChange={(ev) => setNomeEditado(ev.target.value)}
                        onKeyDown={(ev) => {
                          if (ev.key === "Enter") salvarNome(e.id);
                          if (ev.key === "Escape") setEditandoId(null);
                        }}
                        placeholder={RAMO_LABEL[e.ramo]}
                        maxLength={120}
                        className="flex-1 rounded-lg border border-border bg-background px-2 py-1 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                      />
                      <button
                        onClick={() => salvarNome(e.id)}
                        disabled={salvandoId === e.id}
                        className="text-accent hover:text-accent/80 disabled:opacity-60"
                        title="Salvar"
                      >
                        {salvandoId === e.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Check className="h-4 w-4" />
                        )}
                      </button>
                      <button onClick={() => setEditandoId(null)} className="text-muted hover:text-foreground" title="Cancelar">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => router.push(`/estudo-viabilidade/${e.id}`)}
                      className="flex flex-1 items-center gap-2 text-left"
                    >
                      <span className="text-sm font-medium text-foreground">{e.nome || RAMO_LABEL[e.ramo]}</span>
                      {e.nome && <span className="text-xs text-muted">({RAMO_LABEL[e.ramo]})</span>}
                    </button>
                  )}

                  {!editando && (
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="text-xs text-muted">Atualizado em {formatDateTime(e.updatedAt)}</span>
                      <button
                        onClick={() => iniciarEdicao(e)}
                        className="text-muted hover:text-foreground"
                        title="Renomear estudo"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
