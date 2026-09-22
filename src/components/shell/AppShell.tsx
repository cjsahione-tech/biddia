"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutGrid, Building2, Bell, Calculator, BarChart3, FileStack, LogOut, Calendar, Sparkles } from "lucide-react";

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

export function AppShell({
  children,
  userName,
  companyName,
}: {
  children: React.ReactNode;
  userName: string;
  companyName: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [totalNotificacoes, setTotalNotificacoes] = useState(0);

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

  return (
    <div className="flex min-h-screen flex-1">
      <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-surface/50">
        <div className="px-6 py-6">
          <Link href="/dashboard" className="text-lg font-semibold tracking-tight text-foreground">
            Bidd<span className="text-brand">.IA</span>
          </Link>
        </div>

        <nav className="flex-1 space-y-1 px-3">
          {NAV.map((item) => {
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
      </aside>

      <main className="flex-1 overflow-y-auto bg-background">{children}</main>
    </div>
  );
}
