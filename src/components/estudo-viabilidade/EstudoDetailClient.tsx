"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { EtapaStepper } from "@/components/estudo-viabilidade/EtapaStepper";
import { RAMO_LABEL } from "@/lib/estudo-viabilidade";
import type { EstudoViabilidadeItem } from "@/lib/types";

export function EstudoDetailClient({ estudoId }: { estudoId: string }) {
  const [estudo, setEstudo] = useState<EstudoViabilidadeItem | null>(null);

  useEffect(() => {
    let cancelado = false;
    fetch(`/api/estudos/${estudoId}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelado && data.estudo) setEstudo(data.estudo);
      });
    return () => {
      cancelado = true;
    };
  }, [estudoId]);

  if (!estudo) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <Link
        href="/estudo-viabilidade"
        className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Voltar
      </Link>

      <h1 className="mt-4 text-2xl font-semibold text-foreground">
        Estudo de Viabilidade — {RAMO_LABEL[estudo.ramo]}
      </h1>

      <div className="mt-6">
        <EtapaStepper atual="edital" />
      </div>

      <div className="mt-8 rounded-2xl border border-dashed border-border p-10 text-center">
        <p className="text-sm text-muted">
          Próxima etapa (seleção do edital) chega em breve. Por enquanto, o ramo escolhido —{" "}
          <strong className="text-foreground">{RAMO_LABEL[estudo.ramo]}</strong> — já está salvo neste estudo.
        </p>
      </div>
    </div>
  );
}
