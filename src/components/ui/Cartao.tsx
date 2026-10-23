import type { ElementType, HTMLAttributes } from "react";

// Cartão da identidade: superfície branca, cantos de 20px e sombra leve. Sem borda, sem gradiente, sem faixa colorida.
// Padding de 16px; entre cartões, 12px (use `flex flex-col gap-3` ou `grid gap-3`).
type Props = HTMLAttributes<HTMLElement> & {
  as?: ElementType;
  /** false = sem padding (para listas e tabelas que cuidam do próprio espaço). */
  comPadding?: boolean;
};

export function Cartao({ as: Tag = "div", comPadding = true, className, children, ...rest }: Props) {
  return (
    <Tag className={`rounded-card bg-surface shadow-card ${comPadding ? "p-4" : ""} ${className ?? ""}`} {...rest}>
      {children}
    </Tag>
  );
}
