import { Trophy } from "lucide-react";
import { AGENTES } from "@/components/landing/conteudo";

/** Peça visual do topo da home: a esteira dos 6 agentes, do edital ao resultado. Feita só com os tokens da identidade
 * (sem capturas de tela nem números inventados). Cada agente = círculo tint com ícone + número + nome. */
export function EsteiraHero() {
  return (
    <div className="w-full rounded-card bg-surface p-5 text-ink shadow-nav md:p-6">
      <p className="tipo-legenda uppercase tracking-[0.12em] text-brand-600">Esteira do edital</p>
      {/* a linha vertical (before) liga o centro do primeiro círculo ao do último */}
      <ol className="relative mt-4 before:absolute before:bottom-[30px] before:left-[19px] before:top-[30px] before:w-0.5 before:bg-tint before:content-['']">
        {AGENTES.map((agente, i) => (
          <li key={agente.nome} className="relative flex items-center gap-3.5 py-2.5">
            <span className="relative flex h-10 w-10 flex-none items-center justify-center rounded-full bg-tint text-tint-ink">
              <agente.icon className="h-[18px] w-[18px]" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="tipo-legenda block uppercase tracking-[0.08em] text-ink-muted">Agente {i + 1}</span>
              <span className="tipo-corpo-forte block text-ink">{agente.nome.replace("Agente ", "")}</span>
            </span>
            <span className="tipo-pequeno ml-auto text-right text-ink-muted">{agente.resumo}</span>
          </li>
        ))}
      </ol>
      <div className="mt-2 flex items-center gap-3 rounded-tile bg-brand-900 px-4 py-3 text-on-brand">
        <Trophy className="h-5 w-5 flex-none" aria-hidden />
        <span className="tipo-corpo-forte">Você decide e disputa. A IA executa.</span>
      </div>
    </div>
  );
}
