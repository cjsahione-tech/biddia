import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatBRL } from "@/lib/format";
import { AgentPreviewCard } from "@/components/landing/AgentPreviewCard";
import { EsteiraHero } from "@/components/landing/EsteiraHero";
import {
  AGENTES,
  CONTATOS,
  ESTUDOS_VIABILIDADE,
  FRENTES,
  PASSOS,
  RECURSOS,
  WHATSAPP_CONSULTOR,
} from "@/components/landing/conteudo";
import { ArrowRight, Check } from "lucide-react";
import { Logo } from "@/components/ui/Marca";

// Valores padrão usados enquanto o admin não salvou nada em /admin/site (SiteContent
// vazio na primeira execução) — nunca deixa a home pública sem texto.
const CONTEUDO_PADRAO = {
  heroTitulo: "Sua equipe autônoma para participar de licitações públicas",
  heroSubtitulo:
    "A Bidd.IA busca editais por você, analisa cada um, monta a proposta financeira, prepara os anexos jurídicos e mantém a documentação em dia — do jeito certo, todos os dias.",
  heroImagemUrl: null as string | null,
  agentesSecaoTitulo: "Uma esteira completa, do edital à proposta pronta",
  agentesSecaoDescricao:
    "Cada agente tem uma função clara e passa o trabalho adiante — com um auditor sênior conferindo tudo no final.",
  estudoSecaoTitulo: "Estudo de Viabilidade: saiba antes de participar",
  estudoSecaoDescricao:
    "Antes de investir tempo numa licitação, simule se ela vale a pena — com uma metodologia própria para cada tipo de objeto, sempre auditável e nunca com alíquotas ou custos fixos no código.",
};

const LARGURA = "mx-auto w-full max-w-[var(--content-max)] px-[var(--gutter)]";
const BOTAO = "inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-pill px-6 text-[14px] font-bold";

function Cabecalho({ eyebrow, titulo, descricao, sobre = "claro" }: { eyebrow: string; titulo: string; descricao?: string; sobre?: "claro" | "escuro" }) {
  const escuro = sobre === "escuro";
  return (
    <div className="max-w-2xl">
      <p className={`tipo-legenda uppercase tracking-[0.12em] ${escuro ? "text-tint" : "text-brand-600"}`}>{eyebrow}</p>
      <h2 className={`mt-3 font-display text-[28px] font-semibold leading-[1.15] tracking-tight md:text-[36px] ${escuro ? "text-on-brand" : "text-ink"}`}>{titulo}</h2>
      {descricao && <p className={`mt-4 text-[16px] leading-7 ${escuro ? "text-tint" : "text-ink-muted"}`}>{descricao}</p>}
    </div>
  );
}

export default async function LandingPage() {
  const user = await getCurrentUser();
  if (user) {
    redirect(user.company ? "/dashboard" : "/onboarding");
  }

  const [siteContent, planos] = await Promise.all([
    prisma.siteContent.findFirst({ orderBy: { updatedAt: "desc" } }),
    prisma.plan.findMany({
      where: { ativo: true, publicoAlvo: "EMPRESA" },
      orderBy: { ordemExibicao: "asc" },
      include: { features: { include: { feature: true } } },
    }),
  ]);
  const conteudo = { ...CONTEUDO_PADRAO, ...siteContent };

  return (
    <div className="flex-1">
      {/* Navegação */}
      <header className="sticky top-0 z-40 border-b border-border bg-surface">
        <div className={`${LARGURA} flex items-center justify-between gap-4 py-3`}>
          <Logo href="/" className="min-h-11" />
          <nav aria-label="Principal" className="hidden items-center gap-1 lg:flex">
            {[
              ["Como funciona", "#como-funciona"],
              ["Agentes", "#agentes"],
              ["Viabilidade", "#viabilidade"],
              ...(planos.length > 0 ? [["Planos", "#planos"]] : []),
              ["Grupo Bidd", "#grupo"],
            ].map(([rotulo, href]) => (
              <a key={href} href={href} className="inline-flex min-h-11 items-center rounded-pill px-3.5 text-[14px] font-bold text-ink-muted hover:text-ink">
                {rotulo}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <Link href="/login" className="inline-flex min-h-11 items-center whitespace-nowrap rounded-pill px-4 text-[14px] font-bold text-ink-muted hover:text-ink">
              Entrar
            </Link>
            <Link href="/registro" className={`${BOTAO} bg-brand-600 text-on-brand hover:bg-brand-900`}>
              Criar conta
            </Link>
          </div>
        </div>
      </header>

      {/* Topo */}
      <section className="bg-brand-900 text-on-brand">
        <div className={`${LARGURA} grid items-center gap-10 py-14 md:py-20 lg:grid-cols-[1.1fr_1fr] lg:gap-14`}>
          <div>
            <p className="tipo-legenda uppercase tracking-[0.12em] text-tint">Grupo Bidd · consultoria + tecnologia</p>
            <h1 className="mt-5 font-display text-[34px] font-semibold leading-[1.1] tracking-tight md:text-[48px] lg:text-[54px]">{conteudo.heroTitulo}</h1>
            <p className="mt-6 max-w-xl text-[17px] leading-7 text-tint">{conteudo.heroSubtitulo}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              {/* O único destaque âmbar da página: a ação mais importante. */}
              <Link href="/registro" className={`${BOTAO} min-h-12 bg-accent text-on-accent hover:brightness-95`}>
                Começar agora <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
              <Link href="/login" className={`${BOTAO} min-h-12 border-[1.5px] border-on-brand/60 text-on-brand hover:bg-brand-600`}>
                Já tenho conta
              </Link>
            </div>
            <ul className="mt-8 flex flex-wrap gap-2.5">
              {["6 agentes de IA em conjunto", "Editais do PNCP", "Lei nº 14.133/2021"].map((t) => (
                <li key={t} className="tipo-pequeno inline-flex items-center gap-2 rounded-pill bg-brand-600 px-3.5 py-2 text-on-brand">
                  <Check className="h-3.5 w-3.5" aria-hidden /> {t}
                </li>
              ))}
            </ul>
          </div>

          <div className="mx-auto w-full max-w-lg lg:max-w-none">
            {conteudo.heroImagemUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- URL assinada externa de duração longa (ver storage.ts), sem otimização de imagem necessária aqui
              <img src={conteudo.heroImagemUrl} alt="" className="max-h-[420px] w-full rounded-card object-cover shadow-nav" />
            ) : (
              <EsteiraHero />
            )}
          </div>
        </div>
      </section>

      {/* Como funciona */}
      <section id="como-funciona" className="scroll-mt-16">
        <div className={`${LARGURA} py-16 md:py-24`}>
          <Cabecalho
            eyebrow="Como funciona"
            titulo="Do edital ao resultado, sem o trabalho repetitivo"
            descricao="Você define o que procura. A IA executa cada etapa e a sua equipe decide o que disputar."
          />
          <ol className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-5">
            {PASSOS.map((passo, i) => (
              <li key={passo.titulo} className="rounded-card bg-surface p-5 shadow-card">
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-tint font-display text-[20px] font-semibold tabular-nums text-tint-ink">{i + 1}</span>
                <h3 className="tipo-titulo-3 mt-4 text-ink">{passo.titulo}</h3>
                <p className="tipo-corpo mt-2 text-ink-muted">{passo.texto}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Agentes */}
      <section id="agentes" className="scroll-mt-16">
        <div className={`${LARGURA} pb-16 md:pb-24`}>
          <Cabecalho eyebrow="Os 6 agentes" titulo={conteudo.agentesSecaoTitulo} descricao={conteudo.agentesSecaoDescricao} />
          <div className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
            {AGENTES.map((agente, i) => (
              <AgentPreviewCard
                key={agente.nome}
                icon={<agente.icon className="h-5 w-5" />}
                eyebrow={`Agente ${i + 1}`}
                nome={agente.nome}
                descricao={agente.descricao}
                imagens={agente.imagens}
              />
            ))}
          </div>
        </div>
      </section>

      {/* Estudo de viabilidade */}
      <section id="viabilidade" className="scroll-mt-16 bg-tint">
        <div className={`${LARGURA} py-16 md:py-24`}>
          <div className="max-w-2xl">
            <p className="tipo-legenda uppercase tracking-[0.12em] text-tint-ink">Estudo de Viabilidade</p>
            <h2 className="mt-3 font-display text-[28px] font-semibold leading-[1.15] tracking-tight text-tint-ink md:text-[36px]">{conteudo.estudoSecaoTitulo}</h2>
            <p className="mt-4 text-[16px] leading-7 text-tint-ink">{conteudo.estudoSecaoDescricao}</p>
          </div>
          <div className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-2">
            {ESTUDOS_VIABILIDADE.map((estudo) => (
              <AgentPreviewCard
                key={estudo.nome}
                icon={<estudo.icon className="h-5 w-5" />}
                eyebrow={estudo.eyebrow}
                nome={estudo.nome}
                descricao={estudo.descricao}
                imagens={estudo.imagens}
              />
            ))}
          </div>
        </div>
      </section>

      {/* Plataforma */}
      <section id="plataforma" className="scroll-mt-16">
        <div className={`${LARGURA} py-16 md:py-24`}>
          <Cabecalho
            eyebrow="Tudo num só lugar"
            titulo="Acompanhe, decida e registre o resultado"
            descricao="Além dos agentes, a plataforma reúne o que a sua equipe usa todos os dias."
          />
          <div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            {RECURSOS.map((recurso) => (
              <div key={recurso.nome} className="rounded-card bg-surface p-6 shadow-card">
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-tint text-tint-ink">
                  <recurso.icon className="h-5 w-5" aria-hidden />
                </span>
                <h3 className="tipo-titulo-3 mt-4 text-ink">{recurso.nome}</h3>
                <p className="tipo-corpo mt-2 text-ink-muted">{recurso.descricao}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Planos */}
      {planos.length > 0 && (
        <section id="planos" className="scroll-mt-16">
          <div className={`${LARGURA} pb-16 md:pb-24`}>
            <Cabecalho eyebrow="Planos" titulo="Escolha o plano do seu ritmo" descricao="Escolha o plano que combina com o ritmo de licitações da sua empresa." />
            <div className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
              {planos.map((plano) => (
                <div key={plano.id} className="flex flex-col rounded-card bg-surface p-6 shadow-card">
                  <p className="tipo-titulo-3 text-ink">{plano.nome}</p>
                  <p className="tipo-numero mt-3 text-ink">
                    {formatBRL(plano.precoMensal)}
                    <span className="tipo-corpo font-normal text-ink-muted"> /mês</span>
                  </p>
                  <ul className="tipo-corpo mt-5 space-y-2.5 text-ink">
                    <li className="flex items-start gap-2.5">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
                      {plano.maxEditaisAtivos != null ? `${plano.maxEditaisAtivos} editais ativos` : "Editais ativos ilimitados"}
                    </li>
                    <li className="flex items-start gap-2.5">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
                      {plano.maxAnalisesPorMes != null ? `${plano.maxAnalisesPorMes} análises/mês` : "Análises ilimitadas"}
                    </li>
                    {plano.features.map((pf) => (
                      <li key={pf.feature.id} className="flex items-start gap-2.5">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
                        {pf.feature.label}
                      </li>
                    ))}
                  </ul>
                  <Link href="/registro" className={`${BOTAO} mt-6 bg-brand-600 text-on-brand hover:bg-brand-900`}>
                    Começar
                  </Link>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Grupo Bidd */}
      <section id="grupo" className="scroll-mt-16 bg-brand-900 text-on-brand">
        <div className={`${LARGURA} py-16 md:py-24`}>
          <div className="flex flex-wrap items-end justify-between gap-x-12 gap-y-6">
            <div className="max-w-3xl">
              <p className="tipo-legenda uppercase tracking-[0.12em] text-tint">Grupo Bidd</p>
              <h2 className="mt-3 font-display text-[30px] font-semibold leading-[1.1] tracking-tight md:text-[44px]">
                Estratégia humana. Inteligência artificial.{" "}
                <span className="text-tint">Resultado para o cliente.</span>
              </h2>
              <p className="mt-5 text-[16px] leading-7 text-tint">
                O Bidd.IA é a plataforma de tecnologia do Grupo Bidd, grupo de consultoria e desenvolvimento tecnológico. Unimos especialistas em licitações e
                gestão a soluções de IA criadas por nós, para que a sua empresa ganhe tempo, venda mais e decida com segurança.
              </p>
            </div>
          </div>

          <div className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
            {FRENTES.map((frente, i) => (
              <article key={frente.chave} className="flex flex-col rounded-card bg-surface p-6 text-ink shadow-card first:md:col-span-1 last:md:col-span-2 last:lg:col-span-1 md:p-7">
                <div className="flex items-center justify-between gap-3">
                  <span className="tipo-legenda uppercase tracking-[0.08em] text-ink-muted">Frente {i + 1}</span>
                  {frente.etiqueta && (
                    <span className={`tipo-legenda rounded-pill px-3 py-1.5 ${frente.destaque ? "bg-brand-900 text-on-brand" : "bg-neutral-bg text-ink"}`}>{frente.etiqueta}</span>
                  )}
                </div>
                <h3 className="tipo-titulo-2 mt-4 text-ink">{frente.nome}</h3>
                <p className="tipo-corpo mt-3 text-ink-muted">{frente.descricao}</p>
                <ul className="tipo-corpo mt-4 space-y-2 text-ink">
                  {frente.itens.map((item) => (
                    <li key={item} className="flex items-start gap-2.5">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
                      {item}
                    </li>
                  ))}
                </ul>
                <div className="mt-auto pt-6">
                  {frente.chave === "consultoria" && (
                    <a href={WHATSAPP_CONSULTOR} className="inline-flex min-h-11 items-center gap-2 text-[14px] font-bold text-brand-600 hover:text-brand-900">
                      Falar com um consultor <ArrowRight className="h-4 w-4" aria-hidden />
                    </a>
                  )}
                  {frente.chave === "biddia" && (
                    <Link href="/registro" className="inline-flex min-h-11 items-center gap-2 text-[14px] font-bold text-brand-600 hover:text-brand-900">
                      Criar conta no Bidd.IA <ArrowRight className="h-4 w-4" aria-hidden />
                    </Link>
                  )}
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Chamada final */}
      <section className="bg-brand-600 text-on-brand">
        <div className={`${LARGURA} flex flex-wrap items-center justify-between gap-x-10 gap-y-6 py-14 md:py-16`}>
          <div className="max-w-2xl">
            <h2 className="font-display text-[26px] font-semibold leading-[1.15] tracking-tight md:text-[34px]">Dispute mais licitações com o mesmo time.</h2>
            <p className="mt-3 text-[16px] leading-7 text-tint">Crie a sua conta e deixe os agentes cuidarem do trabalho repetitivo. A IA executa, a sua equipe decide.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/registro" className={`${BOTAO} min-h-12 bg-surface text-brand-600 hover:bg-tint`}>
              Criar conta <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
            <a href={WHATSAPP_CONSULTOR} className={`${BOTAO} min-h-12 border-[1.5px] border-on-brand/60 text-on-brand hover:bg-brand-900`}>
              Falar com um consultor
            </a>
          </div>
        </div>
      </section>

      {/* Rodapé */}
      <footer className="bg-brand-900 text-on-brand">
        <div className={`${LARGURA} grid gap-10 py-12 md:grid-cols-[1.4fr_1fr_1fr_1fr]`}>
          <div>
            <Logo sobre="escuro" href="/" className="min-h-11" />
            <p className="tipo-corpo mt-4 max-w-xs text-tint">Bidd.IA é um produto do Grupo Bidd: consultoria e desenvolvimento tecnológico, com o cliente no centro.</p>
          </div>
          <nav aria-label="Produto" className="flex flex-col gap-1">
            <p className="tipo-legenda mb-2 uppercase tracking-[0.1em] text-tint">Produto</p>
            {[
              ["Como funciona", "#como-funciona"],
              ["Agentes", "#agentes"],
              ["Estudo de Viabilidade", "#viabilidade"],
              ...(planos.length > 0 ? [["Planos", "#planos"]] : []),
            ].map(([rotulo, href]) => (
              <a key={href} href={href} className="tipo-corpo inline-flex min-h-11 items-center text-on-brand hover:text-tint">
                {rotulo}
              </a>
            ))}
          </nav>
          <nav aria-label="Conta" className="flex flex-col gap-1">
            <p className="tipo-legenda mb-2 uppercase tracking-[0.1em] text-tint">Conta</p>
            <Link href="/login" className="tipo-corpo inline-flex min-h-11 items-center text-on-brand hover:text-tint">
              Entrar
            </Link>
            <Link href="/registro" className="tipo-corpo inline-flex min-h-11 items-center text-on-brand hover:text-tint">
              Criar conta
            </Link>
          </nav>
          <nav aria-label="Contato" className="flex flex-col gap-1">
            <p className="tipo-legenda mb-2 uppercase tracking-[0.1em] text-tint">Contato</p>
            {CONTATOS.map((c) => (
              <a key={c.href} href={c.href} className="tipo-corpo inline-flex min-h-11 items-center text-on-brand hover:text-tint">
                {c.rotulo}
              </a>
            ))}
          </nav>
        </div>
        <div className={`${LARGURA} border-t border-brand-600 py-6`}>
          <p className="tipo-pequeno text-tint">© {new Date().getFullYear()} Grupo Bidd. Todos os direitos reservados.</p>
          <p className="tipo-pequeno mt-1 text-tint">Dados de editais obtidos publicamente no Portal Nacional de Contratações Públicas (PNCP).</p>
        </div>
      </footer>
    </div>
  );
}
