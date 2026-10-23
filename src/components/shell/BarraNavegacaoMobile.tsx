"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ITENS_NAVEGACAO, ITENS_NAVEGACAO_ADMIN } from "@/components/shell/navegacao";

// Barra inferior flutuante do celular (até 767px): surface, pílula, sombra de navegação, 56px, a 14px das bordas.
// O item ativo vira pílula brand-600 com ícone de 18px e rótulo; os demais mostram só o ícone de 22px.
export function BarraNavegacaoMobile({ apenasAdmin = false }: { apenasAdmin?: boolean }) {
  const pathname = usePathname();
  const itens = apenasAdmin ? ITENS_NAVEGACAO_ADMIN : ITENS_NAVEGACAO;
  return (
    <nav
      aria-label="Navegação principal"
      className="fixed inset-x-3.5 bottom-3.5 z-40 flex h-14 items-center justify-between rounded-pill bg-surface px-2 shadow-nav md:hidden"
      style={{ marginBottom: "env(safe-area-inset-bottom)" }}
    >
      {itens.map((item) => {
        const ativo = item.ativo(pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-label={item.label}
            aria-current={ativo ? "page" : undefined}
            className={`flex h-11 items-center justify-center gap-1.5 rounded-pill text-[13px] font-bold transition ${
              ativo ? "bg-brand-600 px-4 text-on-brand" : "w-11 text-ink-muted"
            }`}
          >
            <item.icon className={ativo ? "h-[18px] w-[18px]" : "h-[22px] w-[22px]"} />
            {ativo && item.label}
          </Link>
        );
      })}
    </nav>
  );
}
