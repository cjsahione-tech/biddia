"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Home, Inbox, Menu, MessageSquare, ShieldCheck, type LucideIcon } from "lucide-react";

type Item = { href: string; label: string; icon: LucideIcon; ativo: (p: string) => boolean };

// Barra flutuante do celular: Início, Editais, Bidd.IA, Resultados e Mais. "Mais" fica ativo em tudo o que
// não é uma das quatro primeiras (Agenda, Documentos, Captação, Plano, Empresa, Notificações, Admin...).
const ITENS: Item[] = [
  { href: "/dashboard", label: "Início", icon: Home, ativo: (p) => p === "/dashboard" },
  { href: "/editais", label: "Editais", icon: Inbox, ativo: (p) => p === "/editais" || p.startsWith("/editais/") },
  { href: "/bidd-ia", label: "Bidd.IA", icon: MessageSquare, ativo: (p) => p === "/bidd-ia" },
  { href: "/resultados", label: "Resultados", icon: BarChart3, ativo: (p) => p === "/resultados" },
  {
    href: "/mais",
    label: "Mais",
    icon: Menu,
    ativo: (p) => !["/dashboard", "/editais", "/bidd-ia", "/resultados"].some((b) => p === b || p.startsWith(b + "/")),
  },
];

// Conta de administração sem empresa: nenhuma das telas comuns funciona, só o Admin.
const ITENS_ADMIN: Item[] = [{ href: "/admin/usuarios", label: "Admin", icon: ShieldCheck, ativo: () => true }];

export function BarraNavegacaoMobile({ apenasAdmin = false }: { apenasAdmin?: boolean }) {
  const pathname = usePathname();
  const itens = apenasAdmin ? ITENS_ADMIN : ITENS;
  return (
    <nav
      aria-label="Navegação principal"
      className="fixed inset-x-3.5 bottom-3.5 z-40 flex items-center justify-between rounded-[28px] bg-white px-2.5 py-2 shadow-[0_4px_14px_rgba(49,46,129,0.14)] md:hidden"
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
            className={`flex h-10 items-center justify-center gap-1.5 rounded-[21px] text-[13px] font-bold transition ${
              ativo ? "bg-brand px-4 text-white" : "w-11 text-muted"
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
