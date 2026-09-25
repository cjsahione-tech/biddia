import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";

// Mesmo controle de acesso de src/lib/admin.ts (só ADMIN_EMAILS) — aqui pro caminho de
// página, não de API route. Sem middleware.ts: cada área protegida faz a própria checagem,
// mesmo padrão já usado no resto do app (ver (app)/layout.tsx).
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user || !isAdminEmail(user.email)) redirect("/dashboard");

  return (
    <div>
      <div className="border-b border-border px-8 pt-6">
        <nav className="flex gap-4 text-sm font-medium text-muted">
          <Link href="/admin/planos" className="border-b-2 border-transparent pb-3 hover:text-foreground">
            Planos
          </Link>
          <Link href="/admin/site" className="border-b-2 border-transparent pb-3 hover:text-foreground">
            Home do site
          </Link>
        </nav>
      </div>
      {children}
    </div>
  );
}
