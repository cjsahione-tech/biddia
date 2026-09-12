import { Check } from "lucide-react";
import { ETAPAS_ESTUDO, type EtapaEstudoKey } from "@/lib/estudo-viabilidade";

/** Indicador visual de progresso do estudo (Etapa 0 a 6) — reutilizado em toda tela do
 * módulo para o usuário sempre saber em que ponto do fluxo está. */
export function EtapaStepper({ atual }: { atual: EtapaEstudoKey }) {
  const idxAtual = ETAPAS_ESTUDO.findIndex((e) => e.key === atual);

  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-1">
      {ETAPAS_ESTUDO.map((etapa, i) => {
        const feita = i < idxAtual;
        const ativa = i === idxAtual;
        return (
          <div key={etapa.key} className="flex shrink-0 items-center gap-1.5">
            <div
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                feita
                  ? "bg-brand text-white"
                  : ativa
                    ? "border-2 border-brand text-brand"
                    : "border border-border text-muted"
              }`}
            >
              {feita ? <Check className="h-3.5 w-3.5" /> : i}
            </div>
            <span className={`whitespace-nowrap text-xs font-medium ${ativa ? "text-foreground" : "text-muted"}`}>
              {etapa.label}
            </span>
            {i < ETAPAS_ESTUDO.length - 1 && <div className="mx-1.5 h-px w-4 shrink-0 bg-border" />}
          </div>
        );
      })}
    </div>
  );
}
