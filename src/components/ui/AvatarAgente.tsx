import { Calculator, ClipboardList, FileSearch, Scale, Search, ShieldCheck, type LucideIcon } from "lucide-react";

// Os 6 agentes. Não têm cor própria: cada um é reconhecido por número, ícone e nome, no mesmo círculo `tint`.
export type NumeroAgente = 1 | 2 | 3 | 4 | 5 | 6;

export const AGENTES: { numero: NumeroAgente; nome: string; funcao: string; icone: LucideIcon }[] = [
  { numero: 1, nome: "Comercial", funcao: "Busca e capta os editais", icone: Search },
  { numero: 2, nome: "Analista", funcao: "Lê e resume o edital", icone: FileSearch },
  { numero: 3, nome: "Financeiro", funcao: "Monta a proposta", icone: Calculator },
  { numero: 4, nome: "Advogado", funcao: "Gera declarações e anexos", icone: Scale },
  { numero: 5, nome: "Secretário", funcao: "Organiza o checklist", icone: ClipboardList },
  { numero: 6, nome: "Auditor", funcao: "Confere a habilitação", icone: ShieldCheck },
];

/** Círculo de 44px em `tint` com o ícone do agente (22px, traço de 2px). */
export function AvatarAgente({ numero, className }: { numero: NumeroAgente; className?: string }) {
  const agente = AGENTES[numero - 1];
  const Icone = agente.icone;
  return (
    <span className={`flex h-11 w-11 flex-none items-center justify-center rounded-full bg-tint text-tint-ink ${className ?? ""}`} aria-hidden>
      <Icone className="h-[22px] w-[22px]" strokeWidth={2} />
    </span>
  );
}

/** Avatar + "AGENTE 1" + nome + função, no formato do guia. */
export function CartaoAgente({ numero }: { numero: NumeroAgente }) {
  const agente = AGENTES[numero - 1];
  return (
    <div className="flex items-center gap-3">
      <AvatarAgente numero={numero} />
      <div className="min-w-0">
        <p className="tipo-legenda text-ink-muted">AGENTE {agente.numero}</p>
        <p className="tipo-titulo-3 truncate text-ink">{agente.nome}</p>
        <p className="tipo-pequeno text-ink-muted">{agente.funcao}</p>
      </div>
    </div>
  );
}
