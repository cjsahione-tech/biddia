import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import {
  Search,
  ClipboardCheck,
  Calculator,
  Scale,
  ListChecks,
  ShieldCheck,
  ArrowRight,
} from "lucide-react";

const AGENTES = [
  {
    icon: Search,
    nome: "Agente Comercial",
    descricao:
      "Varre continuamente os principais portais de licitação do Brasil com base nas suas palavras-chave e traz os editais até você.",
  },
  {
    icon: ClipboardCheck,
    nome: "Agente Analista",
    descricao:
      "Lê cada edital aprovado e explica objeto, obrigações, habilitação e riscos em linguagem clara.",
  },
  {
    icon: Calculator,
    nome: "Agente Financeiro",
    descricao:
      "Monta a composição de itens, quantidades e valores da proposta com base no valor de referência do edital.",
  },
  {
    icon: Scale,
    nome: "Agente Advogado",
    descricao: "Preenche e emite os anexos exigidos, já timbrados com os dados da sua empresa.",
  },
  {
    icon: ListChecks,
    nome: "Agente Secretário",
    descricao:
      "Mantém o checklist de documentos em dia, avisando sobre validades e pendências de cada edital.",
  },
  {
    icon: ShieldCheck,
    nome: "Agente Auditor",
    descricao:
      "Audita cada etapa do time e corrige imediatamente qualquer falha encontrada no processo.",
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
            Licit<span className="text-brand">ax</span>
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
          A Licitax busca editais por você, analisa cada um, monta a proposta financeira,
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
              <div
                key={agente.nome}
                className="rounded-2xl border border-border bg-background p-6 shadow-sm transition hover:shadow-md"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-light text-brand">
                    <agente.icon className="h-5 w-5" />
                  </div>
                  <span className="text-xs font-semibold text-muted">
                    Agente {i + 1}
                  </span>
                </div>
                <h3 className="mt-4 text-base font-semibold text-foreground">{agente.nome}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{agente.descricao}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-6xl px-6 py-8 text-center text-xs text-muted">
          Licitax — dados de editais obtidos publicamente no Portal Nacional de Contratações Públicas (PNCP).
        </div>
      </footer>
    </div>
  );
}
