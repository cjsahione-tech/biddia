import { formatBRL } from "@/lib/format";
import { ORDEM_CENARIOS, ROTULO_CENARIO, type NomeCenario } from "@/lib/estudo-cenarios";

/** Uma linha de números por cenário — serve tanto para um item quanto para o total do estudo. */
export type DadosCenario = {
  precoUnitario?: number | null;
  precoTotal: number | null;
  lucroValor: number | null;
  margemLiquidaPercentual: number | null;
  descontoSobreTetoPercentual: number | null;
  limitadoAoTeto?: boolean;
  acimaDoTeto?: boolean;
};

export function moeda(n: number | null | undefined): string {
  return n == null ? "—" : formatBRL(n);
}

export function percentual(n: number | null | undefined): string {
  return n == null ? "—" : `${n.toFixed(1).replace(".", ",")}%`;
}

/**
 * Tabela com os 3 cenários lado a lado (Inicial, Alvo, Piso). Fica dentro de um bloco com rolagem
 * própria, então em tela de celular nunca estica a página para o lado.
 */
export function TabelaCenarios({
  cenarios,
  mostrarUnitario,
  legenda,
}: {
  cenarios: Record<NomeCenario, DadosCenario>;
  mostrarUnitario: boolean;
  legenda: string;
}) {
  const linhas: { rotulo: string; celula: (c: DadosCenario) => React.ReactNode; forte?: boolean }[] = [];
  if (mostrarUnitario) linhas.push({ rotulo: "Preço por unidade", celula: (c) => moeda(c.precoUnitario ?? null) });
  linhas.push(
    {
      rotulo: "Preço total",
      forte: true,
      celula: (c) => (
        <>
          {moeda(c.precoTotal)}
          {c.limitadoAoTeto && <span className="block text-[11px] font-normal text-ink-muted">travado no valor do edital</span>}
          {c.acimaDoTeto && <span className="block text-[11px] font-normal text-warning-ink">acima do valor do edital</span>}
        </>
      ),
    },
    {
      rotulo: "Lucro",
      celula: (c) => <span className={c.lucroValor != null && c.lucroValor < 0 ? "text-danger-ink" : ""}>{moeda(c.lucroValor)}</span>,
    },
    {
      rotulo: "Margem líquida",
      celula: (c) => (
        <span className={c.margemLiquidaPercentual != null && c.margemLiquidaPercentual < 0 ? "text-danger-ink" : ""}>
          {percentual(c.margemLiquidaPercentual)}
        </span>
      ),
    },
    { rotulo: "Abaixo do edital", celula: (c) => percentual(c.descontoSobreTetoPercentual) }
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[300px] table-fixed border-collapse text-left tabular-nums">
        <caption className="sr-only">{legenda}</caption>
        <thead>
          <tr>
            <th scope="col" className="w-[76px] sm:w-[120px]">
              <span className="sr-only">Valor</span>
            </th>
            {ORDEM_CENARIOS.map((nome) => (
              <th key={nome} scope="col" className="tipo-legenda px-1 pb-2 text-right font-bold text-ink-muted sm:px-2">
                {ROTULO_CENARIO[nome]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((linha) => (
            <tr key={linha.rotulo} className="border-t border-border">
              <th scope="row" className="py-2 pr-1 text-[12px] font-normal leading-tight text-ink-muted">
                {linha.rotulo}
              </th>
              {ORDEM_CENARIOS.map((nome) => (
                <td key={nome} className={`px-1 py-2 text-right text-[12px] sm:px-2 sm:text-[13px] ${linha.forte ? "font-bold text-ink" : "text-ink"}`}>
                  {linha.celula(cenarios[nome])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
