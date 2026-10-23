"use client";

import Link from "next/link";

// Abas de pílula (e as pílulas de etapa do funil). No celular rolam para o lado, sem barra de rolagem; a partir de 768px
// ficam em linha. A ativa é brand-600; as demais, neutras (abas) ou em surface (etapas).
export type ItemAba = { chave: string; rotulo: string; contagem?: number; href?: string };

export function Abas({
  itens,
  ativa,
  onChange,
  variante = "abas",
  rotuloAcessivel,
  className,
}: {
  itens: ItemAba[];
  ativa: string;
  onChange?: (chave: string) => void;
  /** "abas": inativas em neutral-bg (abas do edital). "etapas": inativas em surface (funil Oportunidade · 12). */
  variante?: "abas" | "etapas";
  rotuloAcessivel?: string;
  className?: string;
}) {
  const inativa = variante === "etapas" ? "bg-surface text-ink-muted" : "bg-neutral-bg text-ink-muted";
  return (
    <div
      role="tablist"
      aria-label={rotuloAcessivel}
      className={`rolagem-oculta -mx-[var(--gutter)] flex gap-2 overflow-x-auto px-[var(--gutter)] pb-1 md:mx-0 md:flex-wrap md:overflow-visible md:px-0 ${className ?? ""}`}
    >
      {itens.map((item) => {
        const eAtiva = item.chave === ativa;
        const classes = `inline-flex min-h-11 flex-none items-center whitespace-nowrap rounded-pill px-4 text-[13px] font-bold transition ${
          eAtiva ? "bg-brand-600 text-on-brand" : `${inativa} hover:bg-tint`
        }`;
        const conteudo = (
          <>
            {item.rotulo}
            {item.contagem !== undefined && <span className="ml-1 tabular-nums">· {item.contagem}</span>}
          </>
        );
        return item.href ? (
          <Link key={item.chave} href={item.href} role="tab" aria-selected={eAtiva} className={classes}>
            {conteudo}
          </Link>
        ) : (
          <button key={item.chave} type="button" role="tab" aria-selected={eAtiva} onClick={() => onChange?.(item.chave)} className={classes}>
            {conteudo}
          </button>
        );
      })}
    </div>
  );
}
