"use client";

import Link from "next/link";
import { Bell } from "lucide-react";
import { useShell } from "@/components/shell/ShellContext";
import { iniciais } from "@/lib/painel-util";

// Estrutura de página da identidade: conteúdo com até 1200px, centralizado ao lado do menu, com a margem lateral
// (--gutter) de 18px no celular, 24px no tablet e 32px no computador. Cabeçalho: título (titulo-2 no celular,
// titulo-1 a partir de 768px), subtítulo e ações; no celular o sino e o avatar ficam aqui (no computador, na barra do topo).
export function PaginaConteudo({
  titulo,
  subtitulo,
  acoes,
  children,
  larga = false,
  className,
}: {
  titulo: string;
  subtitulo?: React.ReactNode;
  acoes?: React.ReactNode;
  children: React.ReactNode;
  /** true = ocupa toda a largura (quadro Kanban), sem o limite de 1200px. */
  larga?: boolean;
  className?: string;
}) {
  const { userName, totalNotificacoes } = useShell();
  return (
    <div className={`mx-auto w-full px-[var(--gutter)] pb-8 pt-5 md:pt-8 ${larga ? "" : "max-w-[var(--content-max)]"} ${className ?? ""}`}>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="tipo-titulo-pagina text-ink">{titulo}</h1>
          {subtitulo && <p className="tipo-pequeno mt-1 text-ink-muted">{subtitulo}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {acoes && <div className="hidden flex-wrap items-center justify-end gap-2 md:flex">{acoes}</div>}
          <div className="flex items-center gap-2.5 md:hidden">
            <Link href="/notificacoes" aria-label="Notificações" className="relative flex h-11 w-11 items-center justify-center rounded-full bg-surface text-ink-muted shadow-card">
              <Bell className="h-5 w-5" />
              {totalNotificacoes > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger-ink px-1 text-[11px] font-bold text-on-brand">
                  {totalNotificacoes > 99 ? "99+" : totalNotificacoes}
                </span>
              )}
            </Link>
            <Link href="/empresa" aria-label="Conta e perfil" className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-600 text-[15px] font-bold text-on-brand">
              {iniciais(userName)}
            </Link>
          </div>
        </div>
      </header>
      {acoes && <div className="mt-3 flex flex-wrap items-center gap-2 md:hidden">{acoes}</div>}
      <div className="mt-5 md:mt-6">{children}</div>
    </div>
  );
}
