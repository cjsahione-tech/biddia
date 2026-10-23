import type { ReactNode } from "react";

// Tabela da identidade. Celular: vira cartões empilhados, um por linha (a coluna `titulo` vira o título do cartão e as
// demais viram "rótulo: valor"). Tablet: tabela. Computador: tabela com cabeçalho fixo (no rolamento da página).
// Só uma tabela MUITO larga rola para o lado, dentro do próprio bloco — nunca a página.
export type ColunaTabela<T> = {
  chave: string;
  rotulo: string;
  render: (linha: T) => ReactNode;
  /** Números e valores em reais: alinhados à direita. */
  alinhar?: "esq" | "dir";
  /** Esta coluna é o título da linha no cartão do celular. */
  titulo?: boolean;
};

export function TabelaResponsiva<T>({
  colunas,
  linhas,
  chaveDaLinha,
  vazio = "Nada para mostrar.",
  className,
}: {
  colunas: ColunaTabela<T>[];
  linhas: T[];
  chaveDaLinha: (linha: T) => string;
  vazio?: ReactNode;
  className?: string;
}) {
  if (linhas.length === 0) {
    return <p className={`rounded-card bg-surface p-5 text-center text-sm text-ink-muted shadow-card ${className ?? ""}`}>{vazio}</p>;
  }
  const colunaTitulo = colunas.find((c) => c.titulo) ?? colunas[0];
  const demais = colunas.filter((c) => c !== colunaTitulo);

  return (
    <div className={className}>
      {/* Celular: cartões empilhados */}
      <ul className="flex flex-col gap-3 md:hidden">
        {linhas.map((l) => (
          <li key={chaveDaLinha(l)} className="rounded-card bg-surface p-4 shadow-card">
            <div className="tipo-corpo-forte text-ink">{colunaTitulo.render(l)}</div>
            <dl className="mt-2 space-y-1.5">
              {demais.map((c) => (
                <div key={c.chave} className="flex items-baseline justify-between gap-3 border-t border-border pt-1.5 first:border-t-0 first:pt-0">
                  <dt className="tipo-pequeno text-ink-muted">{c.rotulo}</dt>
                  <dd className="tipo-corpo min-w-0 text-right tabular-nums text-ink">{c.render(l)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>

      {/* Tablet e computador: tabela */}
      <div className="hidden max-w-full overflow-x-auto rounded-card bg-surface shadow-card md:block">
        <table className="w-full border-collapse text-left">
          <thead className="bg-surface lg:sticky lg:top-0 lg:z-10">
            <tr>
              {colunas.map((c) => (
                <th
                  key={c.chave}
                  scope="col"
                  className={`tipo-legenda border-b border-border px-4 py-3 text-ink-muted ${c.alinhar === "dir" ? "text-right" : "text-left"}`}
                >
                  {c.rotulo}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={chaveDaLinha(l)} className="border-b border-border last:border-b-0 hover:bg-page">
                {colunas.map((c) => (
                  <td key={c.chave} className={`tipo-corpo px-4 py-3 align-top text-ink ${c.alinhar === "dir" ? "text-right tabular-nums" : ""}`}>
                    {c.render(l)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
