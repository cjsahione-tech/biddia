import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";

export default async function OnboardingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.company) redirect("/dashboard");

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 py-12">
      <span className="text-lg font-semibold tracking-tight text-foreground">
        Bidd<span className="text-brand">.IA</span>
      </span>
      <h1 className="mt-6 text-2xl font-semibold text-foreground">
        Vamos configurar sua empresa
      </h1>
      <p className="mt-1 text-sm text-muted">
        Essas informações alimentam os seus agentes: da busca de editais à emissão de anexos
        timbrados.
      </p>

      <OnboardingWizard />
    </div>
  );
}
