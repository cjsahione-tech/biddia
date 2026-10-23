"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AlertTriangle, Bell, LogOut, Undo2 } from "lucide-react";
import { ShellProvider } from "@/components/shell/ShellContext";
import { BarraNavegacaoMobile } from "@/components/shell/BarraNavegacaoMobile";
import { ITENS_NAVEGACAO, ITENS_NAVEGACAO_ADMIN } from "@/components/shell/navegacao";
import { Logo } from "@/components/ui/Marca";
import { iniciais } from "@/lib/painel-util";

// Estrutura do sistema, igual em qualquer tela: celular (até 767px) = barra inferior flutuante; tablet e computador
// (a partir de 768px) = menu lateral brand-900 de 248px com os MESMOS 5 destinos, e o conteúdo (até 1200px) ao lado.
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
  // Conta admin sem empresa própria (ex: e-mail de suporte) — nenhuma das abas comuns funciona sem empresa, então o
  // menu mostra só Admin, sem tentar renderizar Editais/Agenda/etc. que dariam erro de "empresa não cadastrada".
  apenasAdmin?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [totalNotificacoes, setTotalNotificacoes] = useState(0);
  const [voltando, setVoltando] = useState(false);

  useEffect(() => {
    fetch("/api/notificacoes")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.notificacoes)) {
          setTotalNotificacoes(data.notificacoes.length + (Array.isArray(data.auditoriasComAcao) ? data.auditoriasComAcao.length : 0));
        }
      })
      .catch(() => {});
  }, [pathname]);

  // Só para administrador: avisa no topo quando a IA está pausada (saldo/chave) e o que fazer.
  const [avisoIA, setAvisoIA] = useState<{ aviso: string; auditoriasGuardadas: number } | null>(null);
  useEffect(() => {
    if (!isAdmin) return;
    fetch("/api/admin/ia-status")
      .then((r) => r.json())
      .then((d) => setAvisoIA(d?.pausada && d.aviso ? { aviso: d.aviso, auditoriasGuardadas: d.auditoriasGuardadas ?? 0 } : null))
      .catch(() => {});
  }, [isAdmin, pathname]);

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

  const itens = apenasAdmin ? ITENS_NAVEGACAO_ADMIN : ITENS_NAVEGACAO;

  return (
    <ShellProvider value={{ userName, companyName, totalNotificacoes, isAdmin, operandoComoAnalista }}>
      <div className="flex min-h-screen flex-1 flex-col">
        {operandoComoAnalista && (
          <div className="flex flex-wrap items-center justify-between gap-2 bg-brand-900 px-[var(--gutter)] py-2 text-sm font-bold text-on-brand">
            <span>Operando como {companyName}</span>
            <button
              onClick={handleVoltarCarteira}
              disabled={voltando}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-pill bg-on-brand/15 px-4 text-xs font-bold hover:bg-on-brand/25 disabled:opacity-60 md:min-h-[34px]"
            >
              <Undo2 className="h-3.5 w-3.5" /> Voltar para minha carteira
            </button>
          </div>
        )}
        {avisoIA && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-warning-bg px-[var(--gutter)] py-2 text-sm font-medium text-warning-ink" role="alert">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{avisoIA.aviso}</span>
            {avisoIA.auditoriasGuardadas > 0 && (
              <span className="text-xs font-normal">
                {avisoIA.auditoriasGuardadas} auditoria(s) guardada(s) — retomam sozinhas quando o saldo voltar.
              </span>
            )}
          </div>
        )}

        <div className="flex min-w-0 flex-1">
          {/* Menu lateral: tablet e computador */}
          <aside className="sticky top-0 hidden h-screen w-[var(--sidebar-w)] shrink-0 flex-col bg-brand-900 text-on-brand md:flex">
            <div className="px-6 py-6">
              <Logo sobre="escuro" href="/dashboard" />
            </div>
            <nav aria-label="Navegação principal" className="flex-1 space-y-1 overflow-y-auto px-3">
              {itens.map((item) => {
                const ativo = item.ativo(pathname);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={ativo ? "page" : undefined}
                    className={`flex min-h-11 items-center gap-3 rounded-pill px-4 text-[14px] font-bold transition ${
                      ativo ? "bg-brand-600 text-on-brand" : "text-on-brand/80 hover:bg-brand-600/40 hover:text-on-brand"
                    }`}
                  >
                    <item.icon className="h-5 w-5" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
            <div className="border-t border-on-brand/15 px-5 py-4">
              <p className="truncate text-sm font-bold text-on-brand">{companyName}</p>
              <p className="truncate text-xs text-on-brand/70">{userName}</p>
              <button onClick={handleLogout} className="mt-2 inline-flex min-h-11 items-center gap-2 text-xs font-bold text-on-brand/80 hover:text-on-brand">
                <LogOut className="h-4 w-4" />
                Sair
              </button>
            </div>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            {/* Barra do topo: tablet e computador (no celular, sino e avatar ficam no cabeçalho de cada tela) */}
            {!apenasAdmin && (
              <div className="hidden h-14 items-center justify-end gap-2.5 px-[var(--gutter)] md:flex">
                <Link
                  href="/notificacoes"
                  aria-label="Notificações"
                  className="relative flex h-11 w-11 items-center justify-center rounded-full bg-surface text-ink-muted shadow-card hover:bg-tint"
                >
                  <Bell className="h-5 w-5" />
                  {totalNotificacoes > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger-ink px-1 text-[11px] font-bold text-on-brand">
                      {totalNotificacoes > 99 ? "99+" : totalNotificacoes}
                    </span>
                  )}
                </Link>
                <Link href="/empresa" aria-label="Conta e perfil" className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-600 text-[15px] font-bold text-on-brand hover:bg-brand-900">
                  {iniciais(userName)}
                </Link>
              </div>
            )}
            <main className="min-w-0 flex-1 overflow-x-hidden pb-28 md:pb-8">{children}</main>
          </div>
        </div>
        <BarraNavegacaoMobile apenasAdmin={apenasAdmin} />
      </div>
    </ShellProvider>
  );
}
