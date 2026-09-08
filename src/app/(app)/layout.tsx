import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { AppShell } from "@/components/shell/AppShell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.company) redirect("/onboarding");

  return (
    <AppShell userName={user.name} companyName={user.company.razaoSocial}>
      {children}
    </AppShell>
  );
}
