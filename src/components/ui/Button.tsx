import type { ButtonHTMLAttributes } from "react";
import { Loader2 } from "lucide-react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  loading?: boolean;
};

const variants: Record<string, string> = {
  primary: "bg-brand text-white hover:bg-brand/90 shadow-sm",
  secondary: "bg-surface text-foreground border border-border hover:bg-border/40",
  ghost: "text-muted hover:text-foreground hover:bg-surface",
  danger: "bg-danger text-white hover:bg-danger/90 shadow-sm",
};

export function Button({ variant = "primary", loading, disabled, className, children, ...rest }: Props) {
  return (
    <button
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${variants[variant]} ${className ?? ""}`}
      {...rest}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}
