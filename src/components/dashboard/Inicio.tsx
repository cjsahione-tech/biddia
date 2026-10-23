"use client";

import { useState } from "react";
import { RefreshCw, Search, Upload } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Esteira } from "@/components/ui/Esteira";
import { PaginaConteudo } from "@/components/ui/PaginaConteudo";
import { useShell } from "@/components/shell/ShellContext";
import { ListaEditais } from "@/components/dashboard/ListaEditais";
import { AvisosDoQuadro, type DadosAvisos } from "@/components/dashboard/AvisosDoQuadro";
import { etapasDaEsteira } from "@/lib/funil";
import { mesmoDiaBrasilia, primeiroNome, saudacao } from "@/lib/painel-util";
import type { EditalListItem } from "@/lib/types";

const SEMANA_MS = 7 * 24 * 3_600_000;

function Indicador({ valor, rotulo, destaque = false, className }: { valor: number; rotulo: string; destaque?: boolean; className?: string }) {
  return (
    <div className={`rounded-tile px-3 py-3 shadow-card md:px-4 ${destaque ? "bg-brand-900 text-on-brand" : "bg-surface text-ink"} ${className ?? ""}`}>
      <p className="tipo-numero">{valor}</p>
      <p className={`tipo-pequeno mt-0.5 ${destaque ? "text-on-brand/80" : "text-ink-muted"}`}>{rotulo}</p>
    </div>
  );
}

/**
 * Tela Início (todas as telas): cumprimento, indicadores do dia, esteira de etapas, e os editais em cartões de 1, 2 ou 3
 * colunas. Mostra os dados reais do quadro. O âmbar é só o "Captar agora" (um por tela).
 */
export function Inicio({
  editais,
  onReload,
  onBuscar,
  onAdicionarPdf,
  buscando,
  enviandoPdf,
  avisos,
}: {
  editais: EditalListItem[];
  onReload: () => void | Promise<void>;
  onBuscar: () => void;
  onAdicionarPdf: () => void;
  buscando: boolean;
  enviandoPdf: boolean;
  avisos: DadosAvisos;
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
  const precisamDeAtencao = ativos.filter((e) => e.habilitacaoStatus === "PRECISA_ACAO_HUMANA" || e.habilitacaoStatus === "REVISAR_MANUALMENTE").length;

  return (
    <PaginaConteudo
      titulo={`${saudacao()}, ${primeiroNome(userName)}`}
      subtitulo="Painel de editais"
      acoes={
        <>
          <Button variant="destaque" onClick={onBuscar} loading={buscando} className="max-md:flex-1">
            {!buscando && <Search className="h-4 w-4" />}
            {buscando ? "Buscando…" : "Captar agora"}
          </Button>
          <Button variant="secondary" onClick={onAdicionarPdf} loading={enviandoPdf} aria-label="Adicionar PDF" className="max-md:w-11 max-md:px-0">
            {!enviandoPdf && <Upload className="h-4 w-4" />}
            <span className="hidden md:inline">Adicionar PDF</span>
          </Button>
          <Button variant="ghost" onClick={() => onReload()} aria-label="Atualizar" className="max-md:w-11 max-md:px-0">
            <RefreshCw className="h-4 w-4" />
            <span className="hidden md:inline">Atualizar</span>
          </Button>
        </>
      }
    >
      <AvisosDoQuadro {...avisos} />

      <div className="grid grid-cols-3 gap-3 md:grid-cols-4">
        <Indicador valor={captadosHoje} rotulo="captados hoje" destaque />
        <Indicador valor={emQualificacao} rotulo="em qualificação" />
        <Indicador valor={sessoesNaSemana} rotulo="sessões na semana" />
        <Indicador valor={precisamDeAtencao} rotulo="pedem sua atenção" className="hidden md:block" />
      </div>

      {/* Celular: pílulas soltas sobre o fundo; tablet e computador: esteira dentro de um cartão. */}
      <div className="mt-3 md:rounded-card md:bg-surface md:p-4 md:shadow-card">
        <Esteira etapas={etapasDaEsteira(editais)} />
      </div>

      <h2 className="tipo-titulo-2 mb-3 mt-6 text-ink">Seus editais</h2>
      <ListaEditais editais={editais} onMovido={onReload} limite={6} />
    </PaginaConteudo>
  );
}
