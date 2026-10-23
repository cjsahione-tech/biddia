import type { LucideIcon } from "lucide-react";

// Chip / selo: 11px, cantos de 10px, ícone + palavra.
//  info    = UF, tipo, prazo normal (tint)       neutro = informação de apoio (neutral-bg)
//  sucesso / atencao / erro = status (sempre com palavra ou ícone — nunca só a cor)
export type TomChip = "info" | "neutro" | "sucesso" | "atencao" | "erro";

const TONS: Record<TomChip, string> = {
  info: "bg-tint text-tint-ink",
  neutro: "bg-neutral-bg text-ink-muted",
  sucesso: "bg-success-bg text-success-ink",
  atencao: "bg-warning-bg text-warning-ink",
  erro: "bg-danger-bg text-danger-ink",
};

export function Chip({
  tom = "info",
  icone: Icone,
  children,
  title,
  className,
}: {
  tom?: TomChip;
  icone?: LucideIcon;
  children: React.ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={`tipo-legenda inline-flex items-center gap-1 rounded-chip px-2 py-1 ${TONS[tom]} ${className ?? ""}`}
    >
      {Icone && <Icone className="h-3 w-3 shrink-0" aria-hidden />}
      {children}
    </span>
  );
}
