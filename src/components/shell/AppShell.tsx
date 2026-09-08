"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutGrid, Building2, LogOut } from "lucide-react";

const NAV = [
  { href: "/dashboard", label: "Editais", icon: LayoutGrid },
  { href: "/empresa", label: "Empresa", icon: Building2 },
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
            Licit<span className="text-brand">ax</span>
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
