"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

// Janela de confirmação / formulário. Celular: painel que sobe da base (bottom sheet). Tablet e computador: janela
// centralizada de 560px. Fecha com Esc, tocando fora ou no X; o foco vai para a janela ao abrir e a página atrás não rola.
export function Janela({
  aberta,
  onFechar,
  titulo,
  descricao,
  children,
  rodape,
}: {
  aberta: boolean;
  onFechar: () => void;
  titulo: string;
  descricao?: string;
  children?: React.ReactNode;
  /** Botões da janela (use `Button`): no celular ficam empilhados e largos; no computador, alinhados à direita. */
  rodape?: React.ReactNode;
}) {
  const painel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberta) return;
    const anterior = document.activeElement as HTMLElement | null;
    painel.current?.focus();
    const bloqueio = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") onFechar();
    };
    document.addEventListener("keydown", aoTeclar);
    return () => {
      document.removeEventListener("keydown", aoTeclar);
      document.body.style.overflow = bloqueio;
      anterior?.focus?.();
    };
  }, [aberta, onFechar]);

  if (!aberta) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center md:p-6" role="presentation">
      <button type="button" aria-label="Fechar" tabIndex={-1} onClick={onFechar} className="absolute inset-0 cursor-default bg-ink/40" />
      <div
        ref={painel}
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        tabIndex={-1}
        className="janela-painel relative flex max-h-[90dvh] w-full flex-col rounded-t-card bg-surface shadow-nav focus:outline-none md:max-w-[560px] md:rounded-card"
      >
        <div className="flex items-start justify-between gap-3 px-[var(--space-5)] pt-[var(--space-5)] md:px-6 md:pt-6">
          <div className="min-w-0">
            <h2 className="tipo-titulo-3 text-ink">{titulo}</h2>
            {descricao && <p className="tipo-pequeno mt-1 text-ink-muted">{descricao}</p>}
          </div>
          <button
            type="button"
            onClick={onFechar}
            aria-label="Fechar janela"
            className="-mr-2 -mt-1 flex h-11 w-11 flex-none items-center justify-center rounded-full text-ink-muted hover:bg-tint"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {children && <div className="tipo-corpo overflow-y-auto px-[var(--space-5)] py-4 md:px-6">{children}</div>}
        {rodape && (
          <div className="flex flex-col gap-2 px-[var(--space-5)] pb-[calc(var(--space-5)+env(safe-area-inset-bottom))] pt-2 md:flex-row md:justify-end md:px-6 md:pb-6 [&>button]:w-full md:[&>button]:w-auto">
            {rodape}
          </div>
        )}
      </div>
    </div>
  );
}
