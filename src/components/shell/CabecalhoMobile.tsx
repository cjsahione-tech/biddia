"use client";

import Link from "next/link";
import { Bell } from "lucide-react";
import { useShell } from "@/components/shell/ShellContext";
import { iniciais } from "@/lib/mobile-util";

/**
 * Cabeçalho das telas do celular: título (e subtítulo) à esquerda, sino de notificações e avatar à direita.
 * Só aparece em telas estreitas; no computador cada página continua com o seu próprio título.
 */
export function CabecalhoMobile({ titulo, subtitulo }: { titulo: string; subtitulo?: string }) {
  const { userName, totalNotificacoes } = useShell();
  return (
    <header className="flex items-start justify-between gap-3 md:hidden">
      <div className="min-w-0">
        <h1 className="truncate text-2xl font-semibold text-foreground">{titulo}</h1>
        {subtitulo && <p className="truncate text-xs text-muted">{subtitulo}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2.5">
        <Link href="/notificacoes" aria-label="Notificações" className="relative flex h-[38px] w-[38px] items-center justify-center rounded-full bg-white text-muted">
          <Bell className="h-[19px] w-[19px]" />
          {totalNotificacoes > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[9px] font-bold text-white">
              {totalNotificacoes > 99 ? "99+" : totalNotificacoes}
            </span>
          )}
        </Link>
        <Link href="/empresa" aria-label="Conta e perfil" className="flex h-[38px] w-[38px] items-center justify-center rounded-full bg-brand text-[15px] font-bold text-white">
          {iniciais(userName)}
        </Link>
      </div>
    </header>
  );
}
