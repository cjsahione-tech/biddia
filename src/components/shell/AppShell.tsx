"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutGrid, Building2, Bell, Calculator, BarChart3, FileStack, LogOut, Calendar, Sparkles, ShieldCheck, Undo2, Menu, X } from "lucide-react";

const NAV = [
  { href: "/bidd-ia", label: "Bidd.IA", icon: Sparkles },
  { href: "/dashboard", label: "Editais", icon: LayoutGrid },
  { href: "/agenda", label: "Agenda", icon: Calendar },
  { href: "/resultados", label: "Resultados", icon: BarChart3 },
  { href: "/documentos", label: "Documentos", icon: FileStack },
  { href: "/estudo-viabilidade", label: "Estudo de Viabilidade", icon: Calculator },
  { href: "/empresa", label: "Empresa", icon: Building2 },
  { href: "/notificacoes", label: "Notificações", icon: Bell },
];

const NAV_ADMIN = { href: "/admin/planos", label: "Admin", icon: ShieldCheck };

export function AppShell({
  children,
  userName,
  companyName,
  isAdmin = false,
  operandoComoAnalista = false,
  apenasAdmin = false,
}: {
  children: React.ReactNode;
  userName: string;
  companyName: string;
  isAdmin?: boolean;
  operandoComoAnalista?: boolean;
  // Conta admin sem empresa própria (ex: e-mail de suporte) — nenhuma das abas comuns
  // funciona sem empresa, então o menu mostra só Admin + Sair, sem tentar renderizar
  // Editais/Agenda/etc. que dariam erro de "empresa não cadastrada".
  apenasAdmin?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [totalNotificacoes, setTotalNotificacoes] = useState(0);
  const [voltando, setVoltando] = useState(false);
  // Em telas estreitas o menu lateral vira uma gaveta aberta pelo botão "hambúrguer".
  const [menuAberto, setMenuAberto] = useState(false);

  useEffect(() => {
    fetch("/api/notificacoes")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.notificacoes)) setTotalNotificacoes(data.notificacoes.length);
      })
      .catch(() => {});
  }, [pathname]);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  async function handleVoltarCarteira() {
    setVoltando(true);
    try {
      await fetch("/api/analista/voltar", { method: "POST" });
      router.push("/carteira");
      router.refresh();
    } finally {
      setVoltando(false);
    }
  }

  const conteudoMenu = (
    <>
      <nav className="flex-1 space-y-1 overflow-y-auto px-3">
        {(apenasAdmin ? [NAV_ADMIN] : isAdmin ? [...NAV, NAV_ADMIN] : NAV).map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                active ? "bg-brand-light text-brand" : "text-muted hover:bg-border/30 hover:text-foreground"
              }`}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
              {item.href === "/notificacoes" && totalNotificacoes > 0 && (
                <span className="ml-auto rounded-full bg-danger px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  {totalNotificacoes}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border px-4 py-4">
        <p className="truncate text-sm font-medium text-foreground">{companyName}</p>
        <p className="truncate text-xs text-muted">{userName}</p>
        <button
          onClick={handleLogout}
          className="mt-3 flex items-center gap-2 text-xs font-medium text-muted hover:text-danger"
        >
          <LogOut className="h-3.5 w-3.5" />
          Sair
        </button>
      </div>
    </>
  );

  const logo = (
    <Link href="/dashboard" className="text-lg font-semibold tracking-tight text-foreground">
      Bidd<span className="text-brand">.IA</span>
    </Link>
  );

  return (
    <div className="flex min-h-screen flex-1 flex-col">
      {operandoComoAnalista && (
        <div className="flex flex-wrap items-center justify-between gap-2 bg-brand px-4 py-2 text-sm font-medium text-white sm:px-6">
          <span>Operando como {companyName}</span>
          <button
            onClick={handleVoltarCarteira}
            disabled={voltando}
            className="flex items-center gap-1.5 rounded-md bg-white/15 px-2.5 py-1 text-xs font-medium hover:bg-white/25 disabled:opacity-60"
          >
            <Undo2 className="h-3.5 w-3.5" /> Voltar para minha carteira
          </button>
        </div>
      )}
      {/* Barra superior — só em telas estreitas (o menu lateral fixo some abaixo de 1024px) */}
      <header className="flex items-center justify-between border-b border-border bg-surface/50 px-4 py-3 lg:hidden">
        {logo}
        <button
          onClick={() => setMenuAberto(true)}
          aria-label="Abrir menu"
          className="rounded-lg p-2 text-muted hover:bg-border/30 hover:text-foreground"
        >
          <Menu className="h-5 w-5" />
        </button>
      </header>

      {menuAberto && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            aria-label="Fechar menu"
            onClick={() => setMenuAberto(false)}
            className="absolute inset-0 bg-black/40"
          />
          <aside
            // Fecha a gaveta ao tocar em qualquer link do menu (a navegação acontece normalmente).
            onClick={(e) => {
              if ((e.target as HTMLElement).closest("a")) setMenuAberto(false);
            }}
            className="relative flex h-full w-64 max-w-[85vw] flex-col bg-background shadow-xl"
          >
            <div className="flex items-center justify-between px-6 py-5">
              {logo}
              <button
                onClick={() => setMenuAberto(false)}
                aria-label="Fechar menu"
                className="rounded-lg p-1.5 text-muted hover:bg-border/30 hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {conteudoMenu}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1">
        <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-surface/50 lg:flex">
          <div className="px-6 py-6">{logo}</div>
          {conteudoMenu}
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden bg-background">{children}</main>
      </div>
    </div>
  );
}
