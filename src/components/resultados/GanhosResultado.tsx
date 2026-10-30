"use client";

import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, Loader2, Trophy } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Cartao } from "@/components/ui/Cartao";
import { Chip } from "@/components/ui/Chip";
import { TabelaResponsiva, type ColunaTabela } from "@/components/ui/TabelaResponsiva";
import { JanelaResultadoGanho } from "@/components/resultados/JanelaResultadoGanho";
import { formatBRL } from "@/lib/format";
import { somaDosItens, type ItemResultado, type ResultadoEditalDados } from "@/lib/planilha-resultado";
import type { GanhoDetalhe } from "@/lib/resultados";

type ItensCarregados = { estado: "carregando" } | { estado: "erro" } | { estado: "ok"; resultado: ResultadoEditalDados | null };

const formatarQuantidade = (q: number) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(q);
const formatarPercentual = (p: number) => `${p.toFixed(1).replace(".", ",")}%`;

const COLUNAS_ITENS: ColunaTabela<ItemResultado>[] = [
  {
    chave: "descricao",
    rotulo: "Item",
    titulo: true,
    render: (i) => (
      <>
        {i.numero != null ? `${i.numero}. ` : ""}
        {i.descricao}
      </>
    ),
  },
  { chave: "quantidade", rotulo: "Quantidade", alinhar: "dir", render: (i) => `${formatarQuantidade(i.quantidade)} ${i.unidade}` },
  { chave: "valorUnitario", rotulo: "Valor unitário", alinhar: "dir", render: (i) => formatBRL(i.valorUnitario) },
  { chave: "valorTotal", rotulo: "Total", alinhar: "dir", render: (i) => formatBRL(i.valorTotal) },
];

/**
 * Seção "Editais ganhos" da página Resultados: valor homologado de cada edital ganho, quanto ficou abaixo do
 * valor do edital e os itens da planilha da proposta final. Quem ainda não tem valor registrado mostra o botão
 * para registrar (vale para cards que foram para Ganhas antes desta janela existir ou pelo menu do card).
 */
export function GanhosResultado({
  ganhos,
  qtdSemRegistro,
  onAtualizar,
}: {
  ganhos: GanhoDetalhe[];
  qtdSemRegistro: number;
  onAtualizar: () => void | Promise<void>;
}) {
  const [abertos, setAbertos] = useState<Record<string, boolean>>({});
  const [itens, setItens] = useState<Record<string, ItensCarregados>>({});
  const [editando, setEditando] = useState<GanhoDetalhe | null>(null);

  async function carregarItens(editalId: string) {
    setItens((atual) => ({ ...atual, [editalId]: { estado: "carregando" } }));
    try {
      const res = await fetch(`/api/editais/${editalId}/resultado`);
      if (!res.ok) throw new Error();
      const dados = (await res.json()) as { resultado: ResultadoEditalDados | null };
      setItens((atual) => ({ ...atual, [editalId]: { estado: "ok", resultado: dados.resultado } }));
    } catch {
      setItens((atual) => ({ ...atual, [editalId]: { estado: "erro" } }));
    }
  }

  function alternar(editalId: string) {
    const abrir = !abertos[editalId];
    setAbertos((atual) => ({ ...atual, [editalId]: abrir }));
    if (abrir && !itens[editalId]) void carregarItens(editalId);
  }

  async function aoSalvar() {
    const id = editando?.editalId;
    setEditando(null);
    if (id) {
      setItens((atual) => {
        const copia = { ...atual };
        delete copia[id];
        return copia;
      });
      if (abertos[id]) void carregarItens(id);
    }
    await onAtualizar();
  }

  return (
    <section className="mt-6" aria-labelledby="titulo-ganhos">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-success-bg text-success-ink">
          <Trophy className="h-[18px] w-[18px]" aria-hidden />
        </span>
        <div className="min-w-0">
          <h3 id="titulo-ganhos" className="tipo-titulo-3 text-ink">
            Editais ganhos
          </h3>
          <p className="tipo-pequeno mt-0.5 text-ink-muted">Valor homologado e itens da proposta final de cada edital ganho.</p>
        </div>
      </div>

      {qtdSemRegistro > 0 && (
        <p className="tipo-pequeno mt-3 flex items-start gap-2 text-warning-ink">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            {qtdSemRegistro} edital(is) ganho(s) ainda sem valor homologado. Nos totais desta página usamos o valor do edital para eles.
          </span>
        </p>
      )}

      <ul className="mt-3 flex flex-col gap-3">
        {ganhos.map((g) => {
          const registrado = g.valorHomologado != null;
          const aberto = !!abertos[g.editalId];
          const carregado = itens[g.editalId];
          return (
            <li key={g.editalId}>
              <Cartao>
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <p className="tipo-corpo-forte break-words text-ink">{g.titulo}</p>
                    <p className="tipo-pequeno text-ink-muted">{g.orgaoNome}</p>
                  </div>
                  <dl className="grid shrink-0 grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3 md:text-right">
                    <div>
                      <dt className="tipo-legenda text-ink-muted">Valor do edital</dt>
                      <dd className="tipo-corpo tabular-nums text-ink">{g.valorReferencia != null ? formatBRL(g.valorReferencia) : "—"}</dd>
                    </div>
                    <div>
                      <dt className="tipo-legenda text-ink-muted">Valor homologado</dt>
                      <dd className="tipo-corpo-forte tabular-nums text-ink">{registrado ? formatBRL(g.valorHomologado!) : "—"}</dd>
                    </div>
                    <div>
                      <dt className="tipo-legenda text-ink-muted">{g.descontoPercentual != null && g.descontoPercentual < 0 ? "Acima do edital" : "Abaixo do edital"}</dt>
                      <dd className="tipo-corpo tabular-nums text-ink">
                        {g.descontoPercentual != null ? formatarPercentual(Math.abs(g.descontoPercentual)) : "—"}
                      </dd>
                    </div>
                  </dl>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {registrado ? (
                    <>
                      <Button variant="secondary" onClick={() => alternar(g.editalId)} aria-expanded={aberto}>
                        {aberto ? <ChevronUp className="h-4 w-4" aria-hidden /> : <ChevronDown className="h-4 w-4" aria-hidden />}
                        {aberto ? "Esconder itens" : "Ver itens"}
                      </Button>
                      <Button variant="ghost" onClick={() => setEditando(g)}>
                        Corrigir resultado
                      </Button>
                    </>
                  ) : (
                    <>
                      <Chip tom="atencao" icone={AlertTriangle}>
                        Sem valor homologado
                      </Chip>
                      <Button onClick={() => setEditando(g)}>Registrar resultado</Button>
                    </>
                  )}
                </div>

                {registrado && aberto && (
                  <div className="mt-3">
                    {(!carregado || carregado.estado === "carregando") && (
                      <p className="tipo-pequeno flex items-center gap-2 text-ink-muted">
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Carregando os itens…
                      </p>
                    )}
                    {carregado?.estado === "erro" && (
                      <p role="alert" className="tipo-pequeno text-danger-ink">
                        Não foi possível carregar os itens.{" "}
                        <button type="button" className="font-bold underline" onClick={() => void carregarItens(g.editalId)}>
                          Tentar de novo
                        </button>
                      </p>
                    )}
                    {carregado?.estado === "ok" &&
                      (carregado.resultado && carregado.resultado.itens.length > 0 ? (
                        <>
                          <TabelaResponsiva
                            colunas={COLUNAS_ITENS}
                            linhas={carregado.resultado.itens}
                            chaveDaLinha={(i) => `${i.numero ?? "s"}-${i.descricao}-${i.valorUnitario}`}
                          />
                          <p className="tipo-pequeno mt-2 text-ink-muted">
                            Soma dos itens: <strong className="text-ink">{formatBRL(somaDosItens(carregado.resultado.itens))}</strong>
                            {carregado.resultado.nomeArquivo ? ` · planilha ${carregado.resultado.nomeArquivo}, guardada na aba Documentos do edital` : ""}
                          </p>
                        </>
                      ) : (
                        <p className="tipo-pequeno text-ink-muted">
                          Este resultado foi salvo sem planilha de itens. Use “Corrigir resultado” para anexar a planilha da proposta final.
                        </p>
                      ))}
                  </div>
                )}
              </Cartao>
            </li>
          );
        })}
      </ul>

      {editando && (
        <JanelaResultadoGanho
          editalId={editando.editalId}
          tituloEdital={editando.titulo}
          valorReferencia={editando.valorReferencia}
          modo="registrar"
          onFechar={() => setEditando(null)}
          onSalvo={aoSalvar}
        />
      )}
    </section>
  );
}
