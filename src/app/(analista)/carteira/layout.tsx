import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { LogoutButton } from "@/components/analista/LogoutButton";

// Home do Analista — sem o AppShell/nav completo do (app), porque as abas de
// Editais/Agenda/etc. só fazem sentido depois de "entrar" no login de um cliente (nesse
// ponto o usuário já é o User do cliente, e cai no layout (app) normal, inalterado).
export default async function CarteiraLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.tipoConta !== "ANALISTA") redirect("/dashboard");

  return (
    <div className="flex min-h-screen flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-border px-8 py-4">
        <Link href="/carteira" className="text-lg font-semibold tracking-tight text-foreground">
          Bidd<span className="text-brand">.IA</span>
        </Link>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted">{user.name}</span>
          <LogoutButton />
        </div>
      </header>
      <main className="flex-1 bg-background">{children}</main>
    </div>
  );
}
