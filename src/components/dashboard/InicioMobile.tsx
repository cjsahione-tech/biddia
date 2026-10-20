"use client";

import { useState } from "react";
import { Loader2, RefreshCw, Search, Upload } from "lucide-react";
import { CabecalhoMobile } from "@/components/shell/CabecalhoMobile";
import { useShell } from "@/components/shell/ShellContext";
import { ListaEditaisMobile } from "@/components/dashboard/ListaEditaisMobile";
import { mesmoDiaBrasilia, primeiroNome, saudacao } from "@/lib/mobile-util";
import type { EditalListItem } from "@/lib/types";

const SEMANA_MS = 7 * 24 * 3_600_000;

/**
 * Tela Início do celular (a mesma página /dashboard, só que no formato do design): cumprimento, três números do dia,
 * ações de busca e a lista de editais por etapa. Mostra os dados reais do quadro.
 */
export function InicioMobile({
  editais,
  onReload,
  onBuscar,
  onAdicionarPdf,
  buscando,
  enviandoPdf,
  mensagem,
}: {
  editais: EditalListItem[];
  onReload: () => void | Promise<void>;
  onBuscar: () => void;
  onAdicionarPdf: () => void;
  buscando: boolean;
  enviandoPdf: boolean;
  mensagem: string | null;
}) {
  const { userName } = useShell();
  const [agora] = useState(() => Date.now());
  const ativos = editais.filter((e) => e.etapaKanban !== "RASCUNHO");
  const captadosHoje = editais.filter((e) => e.fonte !== "MANUAL" && mesmoDiaBrasilia(e.createdAt)).length;
  const emQualificacao = editais.filter((e) => e.etapaKanban === "QUALIFICACAO").length;
  const sessoesNaSemana = ativos.filter((e) => {
    if (!e.dataEncerramentoProposta) return false;
    const t = new Date(e.dataEncerramentoProposta).getTime();
    return t >= agora && t <= agora + SEMANA_MS;
  }).length;

  return (
    <div className="px-4 pt-5 md:hidden">
      <CabecalhoMobile titulo={`${saudacao()}, ${primeiroNome(userName)}`} subtitulo="Painel de editais" />

      <div className="mt-4 grid grid-cols-3 gap-2">
        <div className="rounded-2xl bg-[#312e81] px-3 py-2.5 text-[#f4f5ff]">
          <p className="font-[family-name:var(--font-rubik)] text-[22px] font-semibold text-[#fbbf24]">{captadosHoje}</p>
          <p className="text-[11px] text-[#c7d2fe]">captados hoje</p>
        </div>
        <div className="rounded-2xl bg-white px-3 py-2.5">
          <p className="font-[family-name:var(--font-rubik)] text-[22px] font-semibold text-foreground">{emQualificacao}</p>
          <p className="text-[11px] text-muted">em qualificação</p>
        </div>
        <div className="rounded-2xl bg-white px-3 py-2.5">
          <p className="font-[family-name:var(--font-rubik)] text-[22px] font-semibold text-foreground">{sessoesNaSemana}</p>
          <p className="text-[11px] text-muted">sessões na semana</p>
        </div>
      </div>

      <div className="mt-3 flex gap-2">
        <button
          onClick={onBuscar}
          disabled={buscando}
          className="flex h-11 flex-1 items-center justify-center gap-2 rounded-[22px] bg-brand text-[13px] font-bold text-white disabled:opacity-70"
        >
          {buscando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          {buscando ? "Buscando…" : "Buscar novos editais"}
        </button>
        <button
          onClick={onAdicionarPdf}
          disabled={enviandoPdf}
          aria-label="Adicionar PDF"
          className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-white text-muted disabled:opacity-70"
        >
          {enviandoPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-[18px] w-[18px]" />}
        </button>
        <button onClick={() => onReload()} aria-label="Atualizar" className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-white text-muted">
          <RefreshCw className="h-[18px] w-[18px]" />
        </button>
      </div>
      {mensagem && <p className="mt-3 rounded-2xl bg-white px-4 py-2.5 text-xs text-foreground">{mensagem}</p>}

      <ListaEditaisMobile editais={editais} onMovido={onReload} limite={8} />
    </div>
  );
}
