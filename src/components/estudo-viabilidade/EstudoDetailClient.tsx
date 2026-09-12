"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { EtapaStepper } from "@/components/estudo-viabilidade/EtapaStepper";
import { EtapaEdital, ResumoEdital } from "@/components/estudo-viabilidade/EtapaEdital";
import { EtapaRequisitos } from "@/components/estudo-viabilidade/EtapaRequisitos";
import { RAMO_LABEL, etapaAtualDoEstudo } from "@/lib/estudo-viabilidade";
import type { EstudoViabilidadeDetail } from "@/lib/types";

export function EstudoDetailClient({ estudoId }: { estudoId: string }) {
  const [estudo, setEstudo] = useState<EstudoViabilidadeDetail | null>(null);

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

  const etapa = etapaAtualDoEstudo(estudo);

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
        <EtapaStepper atual={etapa} />
      </div>

      <div className="mt-8 space-y-6">
        {!estudo.editalId && <EtapaEdital estudoId={estudo.id} onVinculado={setEstudo} />}

        {estudo.editalId && (
          <>
            <ResumoEdital estudo={estudo} onTrocar={() => setEstudo({ ...estudo, editalId: null, edital: null })} />
            {etapa === "requisitos" && <EtapaRequisitos estudo={estudo} onUpdated={setEstudo} />}
          </>
        )}
      </div>
    </div>
  );
}
