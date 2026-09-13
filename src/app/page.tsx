import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { AgentPreviewCard } from "@/components/landing/AgentPreviewCard";
import {
  Search,
  ClipboardCheck,
  Calculator,
  Scale,
  ListChecks,
  ShieldCheck,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";

const AGENTES: { icon: LucideIcon; nome: string; descricao: string; imagens: [string, string] }[] = [
  {
    icon: Search,
    nome: "Agente Comercial",
    descricao:
      "Varre continuamente os principais portais de licitação do Brasil com base nas suas palavras-chave e traz os editais até você.",
    imagens: ["/agentes/comercial-1.png", "/agentes/comercial-2.png"],
  },
  {
    icon: ClipboardCheck,
    nome: "Agente Analista",
    descricao:
      "Lê cada edital aprovado e explica objeto, obrigações, habilitação e riscos em linguagem clara.",
    imagens: ["/agentes/analista-1.png", "/agentes/analista-2.png"],
  },
  {
    icon: Calculator,
    nome: "Agente Financeiro",
    descricao:
      "Monta a composição de itens, quantidades e valores da proposta com base no valor de referência do edital.",
    imagens: ["/agentes/financeiro-1.png", "/agentes/financeiro-2.png"],
  },
  {
    icon: Scale,
    nome: "Agente Advogado",
    descricao: "Preenche e emite os anexos exigidos, já timbrados com os dados da sua empresa.",
    imagens: ["/agentes/advogado-1.png", "/agentes/advogado-2.png"],
  },
  {
    icon: ListChecks,
    nome: "Agente Secretário",
    descricao:
      "Mantém o checklist de documentos em dia, avisando sobre validades e pendências de cada edital.",
    imagens: ["/agentes/secretario-1.png", "/agentes/secretario-2.png"],
  },
  {
    icon: ShieldCheck,
    nome: "Agente Auditor",
    descricao:
      "Audita cada etapa do time e corrige imediatamente qualquer falha encontrada no processo.",
    imagens: ["/agentes/auditor-1.png", "/agentes/auditor-2.png"],
  },
];

export default async function LandingPage() {
  const user = await getCurrentUser();
  if (user) {
    redirect(user.company ? "/dashboard" : "/onboarding");
  }

  return (
    <div className="flex-1">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <span className="text-lg font-semibold tracking-tight text-foreground">
            Bidd<span className="text-brand">.IA</span>
          </span>
          <nav className="flex items-center gap-3">
            <Link
              href="/login"
              className="rounded-lg px-4 py-2 text-sm font-medium text-muted hover:text-foreground"
            >
              Entrar
            </Link>
            <Link
              href="/registro"
              className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand/90"
            >
              Criar conta
            </Link>
          </nav>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-6 pb-20 pt-20 text-center">
        <span className="inline-flex items-center rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-muted">
          6 agentes de IA trabalhando em conjunto
        </span>
        <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
          Sua equipe autônoma para participar de licitações públicas
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-muted">
          A Bidd.IA busca editais por você, analisa cada um, monta a proposta financeira,
          prepara os anexos jurídicos e mantém a documentação em dia — do jeito certo, todos os dias.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link
            href="/registro"
            className="inline-flex items-center gap-2 rounded-lg bg-brand px-5 py-3 text-sm font-medium text-white shadow-sm hover:bg-brand/90"
          >
            Começar agora <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="/login"
            className="rounded-lg border border-border px-5 py-3 text-sm font-medium text-foreground hover:bg-surface"
          >
            Já tenho conta
          </Link>
        </div>
      </section>

      <section className="border-t border-border bg-surface/60">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="text-center text-2xl font-semibold text-foreground">
            Uma esteira completa, do edital à proposta pronta
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-sm text-muted">
            Cada agente tem uma função clara e passa o trabalho adiante — com um auditor sênior
            conferindo tudo no final.
          </p>

          <div className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {AGENTES.map((agente, i) => (
              <AgentPreviewCard
                key={agente.nome}
                icon={<agente.icon className="h-5 w-5" />}
                index={i}
                nome={agente.nome}
                descricao={agente.descricao}
                imagens={agente.imagens}
              />
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-6xl px-6 py-8 text-center text-xs text-muted">
          Bidd.IA — dados de editais obtidos publicamente no Portal Nacional de Contratações Públicas (PNCP).
        </div>
      </footer>
    </div>
  );
}
