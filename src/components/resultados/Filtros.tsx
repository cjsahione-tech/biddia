"use client";

import { labelPortal } from "@/lib/fonte-edital";
import { TIPO_OBJETO_LABEL, type FiltrosResultados, type SituacaoFiltro } from "@/lib/resultados";

const SELECT_CLASS =
  "rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";

const SITUACOES: { value: SituacaoFiltro; label: string }[] = [
  { value: "TODOS", label: "Todas as situações" },
  { value: "ANDAMENTO", label: "Em andamento" },
  { value: "GANHOS", label: "Ganhos" },
  { value: "PERDIDOS", label: "Perdidos" },
];

const TIPOS_OBJETO = ["SERVICO", "BEM", "AMBOS", "NAO_CLASSIFICADO"];

function dataDiasAtras(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return d.toISOString().slice(0, 10);
}

const PRESETS: { label: string; de: () => string | null }[] = [
  { label: "30 dias", de: () => dataDiasAtras(30) },
  { label: "90 dias", de: () => dataDiasAtras(90) },
  { label: "12 meses", de: () => dataDiasAtras(365) },
  { label: "Tudo", de: () => null },
];

function presetAtivoLabel(filtros: FiltrosResultados): string | null {
  if (filtros.ate) return null;
  if (filtros.de === null) return "Tudo";
  return PRESETS.find((p) => p.label !== "Tudo" && p.de() === filtros.de)?.label ?? null;
}

export function Filtros({
  filtros,
  onChange,
  opcoesFiltro,
}: {
  filtros: FiltrosResultados;
  onChange: (novo: FiltrosResultados) => void;
  opcoesFiltro: { ufs: string[]; fontes: string[] };
}) {
  function set<K extends keyof FiltrosResultados>(chave: K, valor: FiltrosResultados[K]) {
    onChange({ ...filtros, [chave]: valor });
  }

  const presetAtivo = presetAtivoLabel(filtros);

  return (
    <div className="mt-6 flex flex-wrap items-end gap-x-6 gap-y-3 rounded-xl border border-border bg-surface/50 px-4 py-3.5">
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted">Período</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => onChange({ ...filtros, de: p.de(), ate: null })}
              className={`rounded-md px-2 py-1 text-xs font-medium transition ${
                presetAtivo === p.label ? "bg-brand text-white" : "bg-background text-muted hover:text-foreground"
              } border border-border`}
            >
              {p.label}
            </button>
          ))}
          <input
            type="date"
            value={filtros.de ?? ""}
            onChange={(e) => set("de", e.target.value || null)}
            className={`${SELECT_CLASS} w-[132px]`}
            aria-label="Data inicial"
          />
          <span className="text-xs text-muted">até</span>
          <input
            type="date"
            value={filtros.ate ?? ""}
            onChange={(e) => set("ate", e.target.value || null)}
            className={`${SELECT_CLASS} w-[132px]`}
            aria-label="Data final"
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <label htmlFor="filtroSituacao" className="text-xs font-medium text-muted">
          Situação
        </label>
        <select
          id="filtroSituacao"
          value={filtros.situacao}
          onChange={(e) => set("situacao", e.target.value as SituacaoFiltro)}
          className={SELECT_CLASS}
        >
          {SITUACOES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2">
        <label htmlFor="filtroPortalResultados" className="text-xs font-medium text-muted">
          Portal
        </label>
        <select
          id="filtroPortalResultados"
          value={filtros.fonte ?? ""}
          onChange={(e) => set("fonte", e.target.value || null)}
          className={SELECT_CLASS}
        >
          <option value="">Todos os portais</option>
          {opcoesFiltro.fontes.map((fonte) => (
            <option key={fonte} value={fonte}>
              {labelPortal(fonte)}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2">
        <label htmlFor="filtroUfResultados" className="text-xs font-medium text-muted">
          Estado
        </label>
        <select
          id="filtroUfResultados"
          value={filtros.uf ?? ""}
          onChange={(e) => set("uf", e.target.value || null)}
          className={SELECT_CLASS}
        >
          <option value="">Todos os estados</option>
          {opcoesFiltro.ufs.map((uf) => (
            <option key={uf} value={uf}>
              {uf}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2">
        <label htmlFor="filtroTipoObjeto" className="text-xs font-medium text-muted">
          Tipo de objeto
        </label>
        <select
          id="filtroTipoObjeto"
          value={filtros.tipoObjeto ?? ""}
          onChange={(e) => set("tipoObjeto", e.target.value || null)}
          className={SELECT_CLASS}
        >
          <option value="">Todos os tipos</option>
          {TIPOS_OBJETO.map((t) => (
            <option key={t} value={t}>
              {TIPO_OBJETO_LABEL[t]}
            </option>
          ))}
        </select>
      </div>

      {(filtros.de || filtros.ate || filtros.situacao !== "TODOS" || filtros.fonte || filtros.uf || filtros.tipoObjeto) && (
        <button
          onClick={() => onChange({ de: null, ate: null, situacao: "TODOS", fonte: null, uf: null, tipoObjeto: null })}
          className="text-xs font-medium text-muted hover:text-danger"
        >
          Limpar filtros
        </button>
      )}
    </div>
  );
}
