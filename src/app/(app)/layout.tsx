import { redirect } from "next/navigation";
import { getCurrentUser, getAnalistaOrigemToken } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { AppShell } from "@/components/shell/AppShell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.company) redirect(user.tipoConta === "ANALISTA" ? "/carteira" : "/onboarding");

  // Presente só quando um Analista "entrou" no login deste cliente a partir da carteira
  // (ver POST /api/analista/carteira/[companyId]/entrar) — mostra a faixa de "voltar".
  const operandoComoAnalista = (await getAnalistaOrigemToken()) !== null;

  return (
    <AppShell
      userName={user.name}
      companyName={user.company.razaoSocial}
      isAdmin={isAdminEmail(user.email)}
      operandoComoAnalista={operandoComoAnalista}
    >
      {children}
    </AppShell>
  );
}
