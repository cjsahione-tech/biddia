import type { ButtonHTMLAttributes } from "react";
import { Loader2 } from "lucide-react";

// Botões da identidade Bidd.IA: pílula de 44px (34px no compacto), texto 14px em negrito.
//  primary   = principal: a ação que avança o trabalho (Exportar PDF, Gerar declarações).
//  destaque  = âmbar: no máximo UM por tela (Captar agora).
//  secondary = contorno de 1,5px (Exportar DOCX, Tentar de novo).
//  ghost     = só texto (Ver relatório →).
//  danger    = ação destrutiva (excluir): mesmo formato, cor de erro.
// Desativado: fundo neutro e texto apagado — diga o motivo ao lado do botão.
type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "destaque" | "secondary" | "ghost" | "danger";
  size?: "normal" | "compacto";
  loading?: boolean;
};

const variants: Record<string, string> = {
  primary: "bg-brand-600 text-on-brand hover:bg-brand-900",
  destaque: "bg-accent text-on-accent hover:brightness-95",
  secondary: "border-[1.5px] border-brand-600 bg-surface text-brand-600 hover:bg-tint",
  ghost: "text-brand-600 hover:bg-tint",
  danger: "bg-danger-ink text-on-brand hover:brightness-110",
};

const sizes: Record<string, string> = {
  normal: "min-h-11 px-5",
  compacto: "min-h-[34px] px-4",
};

export function Button({ variant = "primary", size = "normal", loading, disabled, className, children, type = "button", ...rest }: Props) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-pill text-[14px] font-bold leading-none transition disabled:cursor-not-allowed disabled:border-transparent disabled:bg-neutral-bg disabled:text-ink-muted ${sizes[size]} ${variants[variant]} ${className ?? ""}`}
      {...rest}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}
