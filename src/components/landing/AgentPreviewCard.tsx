"use client";

import { useEffect, useState, type ReactNode } from "react";
import Image from "next/image";
import { Maximize2, X } from "lucide-react";

/** Card de agente da landing page: o preview em crossfade roda sempre, em loop, sem
 * precisar de hover — e pode ser expandido para ver as capturas reais em tamanho maior.
 * `icon` chega já renderizado (JSX) pelo Server Component pai — um componente de ícone
 * (função) não pode atravessar a fronteira servidor/cliente como prop. */
export function AgentPreviewCard({
  icon,
  eyebrow,
  nome,
  descricao,
  imagens,
}: {
  icon: ReactNode;
  eyebrow: string;
  nome: string;
  descricao: string;
  imagens: [string, string];
}) {
  const [expandido, setExpandido] = useState(false);

  useEffect(() => {
    if (!expandido) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setExpandido(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [expandido]);

  return (
    <>
      <div className="flex flex-col rounded-card bg-surface p-6 shadow-card">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-tint text-tint-ink">{icon}</div>
          <span className="tipo-legenda uppercase tracking-[0.08em] text-ink-muted">{eyebrow}</span>
        </div>
        <h3 className="tipo-titulo-3 mt-4 text-ink">{nome}</h3>
        <p className="tipo-corpo mt-2 text-ink-muted">{descricao}</p>

        <button
          type="button"
          onClick={() => setExpandido(true)}
          aria-label={`Ampliar o exemplo do ${nome}`}
          className="group relative mt-5 block h-40 w-full overflow-hidden rounded-tile bg-page"
        >
          <Image
            src={imagens[0]}
            alt={`Exemplo real de execução do ${nome}`}
            fill
            sizes="(min-width: 1100px) 33vw, (min-width: 768px) 50vw, 100vw"
            className="object-cover object-top [animation:agente-crossfade-a_5s_ease-in-out_infinite]"
          />
          <Image
            src={imagens[1]}
            alt=""
            fill
            sizes="(min-width: 1100px) 33vw, (min-width: 768px) 50vw, 100vw"
            className="object-cover object-top [animation:agente-crossfade-b_5s_ease-in-out_infinite]"
          />
          <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-chip bg-surface/90 px-2.5 py-1.5 text-[11px] font-bold text-ink shadow-card">
            <Maximize2 className="h-3 w-3" aria-hidden /> Ampliar
          </span>
        </button>
      </div>

      {expandido && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={nome}
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4 md:p-6"
          onClick={() => setExpandido(false)}
        >
          <div className="relative w-full max-w-3xl overflow-hidden rounded-card bg-surface shadow-nav" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setExpandido(false)}
              className="absolute right-3 top-3 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-surface/90 text-ink-muted shadow-card hover:text-ink"
              aria-label="Fechar"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="relative h-[60vh] w-full bg-page">
              <Image
                src={imagens[0]}
                alt={`Exemplo real de execução do ${nome}`}
                fill
                sizes="100vw"
                className="object-contain [animation:agente-crossfade-a_5s_ease-in-out_infinite]"
              />
              <Image
                src={imagens[1]}
                alt=""
                fill
                sizes="100vw"
                className="object-contain [animation:agente-crossfade-b_5s_ease-in-out_infinite]"
              />
            </div>
            <div className="border-t border-border p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-tint text-tint-ink">{icon}</div>
                <h3 className="tipo-titulo-3 text-ink">{nome}</h3>
              </div>
              <p className="tipo-corpo mt-2 text-ink-muted">{descricao}</p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
