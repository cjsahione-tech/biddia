import { Check } from "lucide-react";

// Esteira de etapas: Oportunidade (Comercial) → Qualificação (Auditor) → Análise (Analista e Financeiro) → Proposta (Advogado e Secretário).
// Celular: fila de pílulas com a contagem. Tablet e computador: esteira completa, com os círculos ligados por uma linha.
//  Concluída: círculo brand-600 com conector brand-600. Atual: círculo accent. Futura: neutral-bg com conector border.
//  O âmbar (accent) vale uma vez por tela: só marque uma etapa como atual quando for esse o destaque da tela.
export type EtapaEsteira = { chave: string; rotulo: string; agentes: string; contagem: number };

export const ETAPAS_ESTEIRA: Omit<EtapaEsteira, "contagem">[] = [
  { chave: "oportunidade", rotulo: "Oportunidade", agentes: "Comercial" },
  { chave: "qualificacao", rotulo: "Qualificação", agentes: "Auditor" },
  { chave: "analise", rotulo: "Análise", agentes: "Analista e Financeiro" },
  { chave: "proposta", rotulo: "Proposta", agentes: "Advogado e Secretário" },
];

export function Esteira({ etapas, atual }: { etapas: EtapaEsteira[]; /** índice da etapa atual (0 a 3); sem valor = nenhuma destacada */ atual?: number }) {
  const estado = (i: number) => (atual === undefined ? "futura" : i < atual ? "concluida" : i === atual ? "atual" : "futura");
  return (
    <>
      {/* Celular: pílulas com contagem */}
      <ol className="rolagem-oculta -mx-[var(--gutter)] flex gap-2 overflow-x-auto px-[var(--gutter)] md:hidden" aria-label="Etapas">
        {etapas.map((e, i) => (
          <li
            key={e.chave}
            className={`flex-none whitespace-nowrap rounded-pill px-4 py-2.5 text-[13px] font-bold ${
              estado(i) === "atual" ? "bg-accent text-on-accent" : estado(i) === "concluida" ? "bg-brand-600 text-on-brand" : "bg-surface text-ink-muted"
            }`}
          >
            {e.rotulo} · <span className="tabular-nums">{e.contagem}</span>
          </li>
        ))}
      </ol>

      {/* Tablet e computador: esteira completa */}
      <ol className="hidden grid-cols-4 md:grid" aria-label="Etapas">
        {etapas.map((e, i) => {
          const s = estado(i);
          const ultima = i === etapas.length - 1;
          return (
            <li key={e.chave} className="relative flex flex-col items-center text-center">
              {!ultima && (
                <span
                  aria-hidden
                  className={`absolute left-1/2 top-[15px] h-0.5 w-full ${s === "concluida" ? "bg-brand-600" : "bg-border"}`}
                />
              )}
              <span
                className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-full text-[13px] font-bold ${
                  s === "concluida" ? "bg-brand-600 text-on-brand" : s === "atual" ? "bg-accent text-on-accent" : "bg-neutral-bg text-ink-muted"
                }`}
              >
                {s === "concluida" ? <Check className="h-4 w-4" strokeWidth={3} aria-hidden /> : i + 1}
              </span>
              <p className="tipo-corpo-forte mt-2 text-ink">{e.rotulo}</p>
              <p className="tipo-pequeno text-ink-muted">{e.agentes}</p>
              <p className="tipo-numero mt-1 text-ink">{e.contagem}</p>
            </li>
          );
        })}
      </ol>
    </>
  );
}
