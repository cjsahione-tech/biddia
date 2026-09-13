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
      <div className="rounded-2xl border border-border bg-background p-6 shadow-sm transition hover:shadow-md">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-light text-brand">
            {icon}
          </div>
          <span className="text-xs font-semibold text-muted">{eyebrow}</span>
        </div>
        <h3 className="mt-4 text-base font-semibold text-foreground">{nome}</h3>
        <p className="mt-2 text-sm leading-relaxed text-muted">{descricao}</p>

        <button
          onClick={() => setExpandido(true)}
          className="group relative mt-4 block h-40 w-full overflow-hidden rounded-xl border border-border bg-surface"
        >
          <Image
            src={imagens[0]}
            alt={`Exemplo real de execução do ${nome}`}
            fill
            sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
            className="object-cover object-top [animation:agente-crossfade-a_5s_ease-in-out_infinite]"
          />
          <Image
            src={imagens[1]}
            alt=""
            fill
            sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
            className="object-cover object-top [animation:agente-crossfade-b_5s_ease-in-out_infinite]"
          />
          <span className="absolute inset-0 bg-foreground/0 transition-colors group-hover:bg-foreground/5" />
          <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-lg bg-background/90 px-2 py-1 text-[11px] font-medium text-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
            <Maximize2 className="h-3 w-3" /> Expandir
          </span>
        </button>
      </div>

      {expandido && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/60 p-6"
          onClick={() => setExpandido(false)}
        >
          <div
            className="relative w-full max-w-3xl overflow-hidden rounded-2xl bg-background shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setExpandido(false)}
              className="absolute right-3 top-3 z-10 rounded-full bg-background/90 p-1.5 text-muted shadow-sm hover:text-foreground"
              aria-label="Fechar"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="relative h-[65vh] w-full bg-surface">
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
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-light text-brand">
                  {icon}
                </div>
                <h3 className="text-base font-semibold text-foreground">{nome}</h3>
              </div>
              <p className="mt-2 text-sm text-muted">{descricao}</p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
