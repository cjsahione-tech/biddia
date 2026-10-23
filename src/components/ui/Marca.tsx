import Image from "next/image";
import Link from "next/link";

// Marca da Bidd.IA. O símbolo é o "b" do GrupoBidd (400:537): nunca redesenhar nem mudar as proporções.
//  - marca-b-branca sobre fundos brand-900 e brand-600; marca-b-indigo sobre page e surface.
//  - O nome se escreve "Bidd.IA" em Rubik 600; o ".IA" fica em accent (âmbar) sobre fundo escuro e em brand-600 sobre fundo claro.
//  - Sem sombra, contorno ou gradiente.
const PROPORCAO = 400 / 537;

/** Só o símbolo "b". `altura` em px; a largura segue a proporção original. */
export function SimboloB({ cor, altura = 28, className }: { cor: "branca" | "indigo"; altura?: number; className?: string }) {
  return (
    <Image
      src={cor === "branca" ? "/marca/marca-b-branca.png" : "/marca/marca-b-indigo.png"}
      alt=""
      aria-hidden
      width={Math.round(altura * PROPORCAO)}
      height={altura}
      priority
      className={className}
    />
  );
}

/** Símbolo + nome "Bidd.IA". `sobre`: fundo em que o logo fica ("escuro" = brand-900/brand-600, "claro" = page/surface). */
export function Logo({ sobre = "claro", href, altura = 28, className }: { sobre?: "claro" | "escuro"; href?: string; altura?: number; className?: string }) {
  const conteudo = (
    <span className={`inline-flex items-center gap-2.5 ${className ?? ""}`}>
      <SimboloB cor={sobre === "escuro" ? "branca" : "indigo"} altura={altura} />
      <span className={`font-display text-[20px] font-semibold leading-none tracking-tight ${sobre === "escuro" ? "text-on-brand" : "text-ink"}`}>
        Bidd<span className={sobre === "escuro" ? "text-accent" : "text-brand-600"}>.IA</span>
      </span>
    </span>
  );
  return href ? (
    <Link href={href} aria-label="Bidd.IA — início">
      {conteudo}
    </Link>
  ) : (
    conteudo
  );
}

/** Avatar do assistente Bidd.IA (chat): círculo brand-900 com o "b" branco a cerca de 55% da altura. */
export function AvatarBidd({ tamanho = 36, className }: { tamanho?: number; className?: string }) {
  return (
    <span
      className={`flex flex-none items-center justify-center rounded-full bg-brand-900 ${className ?? ""}`}
      style={{ width: tamanho, height: tamanho }}
      aria-hidden
    >
      <SimboloB cor="branca" altura={Math.round(tamanho * 0.55)} />
    </span>
  );
}
