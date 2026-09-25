import { redirect } from "next/navigation";
import { getCurrentUser, getAnalistaOrigemToken } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { AppShell } from "@/components/shell/AppShell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const admin = isAdminEmail(user.email);

  // Conta de suporte/admin pura (ex: suporte@bidd.com.br) não precisa ter empresa própria
  // cadastrada só pra acessar o /admin — qualquer outra conta sem empresa continua indo
  // pro onboarding/carteira normalmente.
  if (!user.company) {
    if (!admin) redirect(user.tipoConta === "ANALISTA" ? "/carteira" : "/onboarding");
    return (
      <AppShell userName={user.name} companyName="Painel Admin" isAdmin apenasAdmin>
        {children}
      </AppShell>
    );
  }

  // Presente só quando um Analista "entrou" no login deste cliente a partir da carteira
  // (ver POST /api/analista/carteira/[companyId]/entrar) — mostra a faixa de "voltar".
  const operandoComoAnalista = (await getAnalistaOrigemToken()) !== null;

  return (
    <AppShell
      userName={user.name}
      companyName={user.company.razaoSocial}
      isAdmin={admin}
      operandoComoAnalista={operandoComoAnalista}
    >
      {children}
    </AppShell>
  );
}
