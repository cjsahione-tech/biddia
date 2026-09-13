"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Loader2, Pencil, X } from "lucide-react";
import { EtapaStepper } from "@/components/estudo-viabilidade/EtapaStepper";
import { EtapaEdital, ResumoEdital } from "@/components/estudo-viabilidade/EtapaEdital";
import { EtapaRequisitos } from "@/components/estudo-viabilidade/EtapaRequisitos";
import { EtapaTributos } from "@/components/estudo-viabilidade/EtapaTributos";
import { EtapaCustos } from "@/components/estudo-viabilidade/EtapaCustos";
import { EtapaCalculo } from "@/components/estudo-viabilidade/EtapaCalculo";
import { EtapaRelatorio } from "@/components/estudo-viabilidade/EtapaRelatorio";
import { RAMO_LABEL, etapaAtualDoEstudo } from "@/lib/estudo-viabilidade";
import type { EstudoViabilidadeDetail } from "@/lib/types";

export function EstudoDetailClient({ estudoId }: { estudoId: string }) {
  const [estudo, setEstudo] = useState<EstudoViabilidadeDetail | null>(null);
  const [editandoNome, setEditandoNome] = useState(false);
  const [nomeEditado, setNomeEditado] = useState("");
  const [salvandoNome, setSalvandoNome] = useState(false);

  async function salvarNome() {
    setSalvandoNome(true);
    try {
      const res = await fetch(`/api/estudos/${estudoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: nomeEditado.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.estudo) {
        setEstudo((prev) => (prev ? { ...prev, nome: data.estudo.nome } : prev));
        setEditandoNome(false);
      }
    } finally {
      setSalvandoNome(false);
    }
  }

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

      {editandoNome ? (
        <div className="mt-4 flex items-center gap-2">
          <input
            autoFocus
            value={nomeEditado}
            onChange={(e) => setNomeEditado(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") salvarNome();
              if (e.key === "Escape") setEditandoNome(false);
            }}
            placeholder={`Estudo de Viabilidade — ${RAMO_LABEL[estudo.ramo]}`}
            maxLength={120}
            className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-2xl font-semibold text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
          />
          <button onClick={salvarNome} disabled={salvandoNome} className="text-accent hover:text-accent/80 disabled:opacity-60" title="Salvar">
            {salvandoNome ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}
          </button>
          <button onClick={() => setEditandoNome(false)} className="text-muted hover:text-foreground" title="Cancelar">
            <X className="h-5 w-5" />
          </button>
        </div>
      ) : (
        <div className="mt-4 flex items-center gap-2">
          <h1 className="text-2xl font-semibold text-foreground">
            {estudo.nome || `Estudo de Viabilidade — ${RAMO_LABEL[estudo.ramo]}`}
          </h1>
          <button
            onClick={() => {
              setNomeEditado(estudo.nome ?? "");
              setEditandoNome(true);
            }}
            className="text-muted hover:text-foreground"
            title="Renomear estudo"
          >
            <Pencil className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="mt-6">
        <EtapaStepper atual={etapa} />
      </div>

      {/*
        Cada etapa concluída fica empilhada (não some quando a próxima começa) — cada
        componente já decide sozinho se mostra "ainda não feito"/formulário/resumo
        confirmado a partir dos próprios dados do estudo. Isso evita repetir o bug de
        etapas anteriores ficarem inacessíveis assim que a seguinte existisse.
      */}
      <div className="mt-8 space-y-6">
        {!estudo.editalId && <EtapaEdital estudoId={estudo.id} onVinculado={setEstudo} />}

        {estudo.editalId && (
          <>
            <ResumoEdital estudo={estudo} onTrocar={() => setEstudo({ ...estudo, editalId: null, edital: null })} />
            <EtapaRequisitos estudo={estudo} onUpdated={setEstudo} />
            {estudo.requisitosConfirmadoEm && <EtapaTributos estudo={estudo} onUpdated={setEstudo} />}
            {estudo.tributosConfirmadoEm && <EtapaCustos estudo={estudo} onUpdated={setEstudo} />}
            {estudo.custosConfirmadoEm && <EtapaCalculo estudo={estudo} onUpdated={setEstudo} />}
            {estudo.calculoConfirmadoEm && <EtapaRelatorio estudo={estudo} />}
          </>
        )}
      </div>
    </div>
  );
}
