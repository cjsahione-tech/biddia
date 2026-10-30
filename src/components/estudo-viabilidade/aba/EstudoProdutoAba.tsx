"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Sparkles, XCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Cartao } from "@/components/ui/Cartao";
import { Chip, type TomChip } from "@/components/ui/Chip";
import { Field, TextInput } from "@/components/ui/Field";
import { EtapaRelatorio } from "@/components/estudo-viabilidade/EtapaRelatorio";
import { RegimeRapido } from "@/components/estudo-viabilidade/aba/RegimeRapido";
import { TabelaCenarios, moeda } from "@/components/estudo-viabilidade/aba/TabelaCenarios";
import { formatDate, formatDateTime } from "@/lib/format";
import { escreverNumeroBR, lerNumeroBR } from "@/lib/numero-br";
import {
  ROTULO_STATUS,
  calcularCenarios,
  explicarResultado,
  validarMargens,
  type ItemCenarioInput,
  type MargensEstudo,
  type ResultadoCenarios,
  type StatusEstudo,
  type StatusItem,
} from "@/lib/estudo-cenarios";
import type { CorpoSalvarProduto, ItemEstudoAba, PacoteAba, PacoteProduto } from "@/lib/estudo-aba-tipos";

type Linha = { custo: string; frete: string; icms: string; fornecedor: string; referencia: string; mudou: boolean };
type MargensTexto = { inicial: string; alvo: string; piso: string; despesas: string };

const TOM_STATUS: Record<StatusItem | StatusEstudo, { tom: TomChip; icone: typeof CheckCircle2 }> = {
  VIAVEL_COMPETITIVO: { tom: "sucesso", icone: CheckCircle2 },
  DISPUTA_APERTADA: { tom: "atencao", icone: AlertTriangle },
  INVIAVEL: { tom: "erro", icone: XCircle },
  SEM_CUSTO: { tom: "neutro", icone: AlertTriangle },
  SEM_TETO: { tom: "neutro", icone: AlertTriangle },
  INCOMPLETO: { tom: "neutro", icone: AlertTriangle },
};

function ChipStatus({ status }: { status: StatusItem | StatusEstudo }) {
  const cfg = TOM_STATUS[status];
  return (
    <Chip tom={cfg.tom} icone={cfg.icone}>
      {ROTULO_STATUS[status]}
    </Chip>
  );
}

/** O valor de referência do edital está faltando (ou foi digitado antes): o campo aparece para o usuário. */
function precisaReferencia(item: ItemEstudoAba): boolean {
  return item.valorTotalReferencia <= 0 || item.valorReferenciaManual;
}

function numeroOuVazio(n: number): string {
  return n > 0 ? escreverNumeroBR(n) : "";
}

function linhasIniciais(itens: ItemEstudoAba[]): Linha[] {
  return itens.map((it) => ({
    custo: numeroOuVazio(it.custos.custoAquisicaoUnitario),
    frete: numeroOuVazio(it.custos.freteLogistica),
    icms: numeroOuVazio(it.custos.icmsStDifal),
    fornecedor: it.custos.fornecedor,
    referencia: it.valorReferenciaManual ? numeroOuVazio(it.valorUnitarioReferencia) : "",
    mudou: false,
  }));
}

function margensIniciais(produto: PacoteProduto): MargensTexto {
  const m = produto.margens;
  return {
    inicial: escreverNumeroBR(m.inicial, 1),
    alvo: escreverNumeroBR(m.alvo, 1),
    piso: escreverNumeroBR(m.piso, 1),
    despesas: escreverNumeroBR(m.despesas, 1),
  };
}

/**
 * Estudo de viabilidade de PRODUTOS dentro da aba do edital: uma tela só, com os custos de cada item
 * e, ao lado, os três preços (Inicial, Alvo e Piso) que se atualizam enquanto você digita.
 * O que o Bidd.IA já sabe dos seus estudos anteriores vem preenchido — mas só vale depois de você conferir e salvar.
 */
export function EstudoProdutoAba({ pacote, onPacote }: { pacote: PacoteAba; onPacote: (p: PacoteAba) => void }) {
  const produto = pacote.produto as PacoteProduto;
  const estudo = pacote.estudo;
  const concluidoEm = estudo?.calculoConfirmadoEm ?? null;

  const [linhas, setLinhas] = useState<Linha[]>(() => linhasIniciais(produto.itens));
  const [margensTxt, setMargensTxt] = useState<MargensTexto>(() => margensIniciais(produto));
  const [sujo, setSujo] = useState(false);
  const [salvando, setSalvando] = useState<"rascunho" | "concluir" | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [relatorioAberto, setRelatorioAberto] = useState(false);

  const percentualTributos = produto.percentualTributos;

  /* ---------- conta ao vivo ---------- */
  const piso = lerNumeroBR(margensTxt.piso);
  const alvo = lerNumeroBR(margensTxt.alvo);
  const inicial = lerNumeroBR(margensTxt.inicial);
  const despesas = lerNumeroBR(margensTxt.despesas) ?? 0;

  let avisoMargens: string | null = null;
  let margens: MargensEstudo | null = null;
  if (piso == null || alvo == null || inicial == null) {
    avisoMargens = "Preencha as três margens (inicial, alvo e mínima).";
  } else {
    margens = { piso, alvo, inicial };
    avisoMargens = validarMargens(margens, percentualTributos ?? 0);
  }
  if (despesas < 0 || despesas >= 100) avisoMargens = avisoMargens ?? "As despesas precisam estar entre 0% e 99%.";

  let resultado: ResultadoCenarios | null = null;
  if (margens && !avisoMargens && percentualTributos != null) {
    const entradas: ItemCenarioInput[] = produto.itens.map((it, i) => {
      const l = linhas[i];
      const referencia = precisaReferencia(it) ? Math.round((lerNumeroBR(l.referencia) ?? 0) * it.quantidade * 100) / 100 : it.valorTotalReferencia;
      return {
        descricao: it.descricao,
        quantidade: it.quantidade,
        valorTetoTotal: referencia,
        custos: {
          custoAquisicaoUnitario: lerNumeroBR(l.custo) ?? 0,
          freteLogistica: lerNumeroBR(l.frete) ?? 0,
          icmsStDifal: lerNumeroBR(l.icms) ?? 0,
          despesasComerciaisAdmin: despesas,
          margemLucroDesejada: margens!.alvo,
        },
      };
    });
    resultado = calcularCenarios(entradas, percentualTributos, margens);
  }

  /* ---------- edição ---------- */
  function mudarLinha(i: number, campo: keyof Omit<Linha, "mudou">, valor: string) {
    setLinhas((atuais) => atuais.map((l, idx) => (idx === i ? { ...l, [campo]: valor, mudou: true } : l)));
    setSujo(true);
  }

  function mudarMargem(campo: keyof MargensTexto, valor: string) {
    setMargensTxt((atuais) => ({ ...atuais, [campo]: valor }));
    setSujo(true);
  }

  async function salvar(acao: "rascunho" | "concluir") {
    if (!margens || avisoMargens) {
      setErro(avisoMargens ?? "Confira as margens.");
      return;
    }
    const corpo: CorpoSalvarProduto = {
      acao,
      margens: { ...margens, despesas },
      itens: produto.itens.map((it, i) => {
        const l = linhas[i];
        const fornecedor = l.fornecedor.trim();
        return {
          itemIndex: it.itemIndex,
          custos: {
            custoAquisicaoUnitario: lerNumeroBR(l.custo) ?? 0,
            freteLogistica: lerNumeroBR(l.frete) ?? 0,
            icmsStDifal: lerNumeroBR(l.icms) ?? 0,
            ...(fornecedor ? { fornecedor } : {}),
          },
          ...(precisaReferencia(it) ? { valorReferenciaUnitario: lerNumeroBR(l.referencia) ?? 0 } : {}),
        };
      }),
    };

    setSalvando(acao);
    setErro(null);
    try {
      const res = await fetch(`/api/editais/${pacote.edital.id}/estudo`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      });
      const data = await res.json();
      if (!res.ok) {
        setErro(data.error ?? "Não foi possível salvar o estudo.");
        return;
      }
      onPacote(data as PacoteAba);
      setSujo(false);
      if (acao === "concluir") setRelatorioAberto(false);
    } catch {
      setErro("Sem conexão. Seus números continuam na tela — tente salvar de novo.");
    } finally {
      setSalvando(null);
    }
  }

  const motivoNaoConcluir = avisoMargens ?? (resultado && resultado.consolidado.status === "INCOMPLETO" ? explicarResultado(resultado) : null);
  const consolidado = resultado?.consolidado ?? null;

  return (
    <div className="space-y-4">
      {/* 1. Regime de impostos */}
      <RegimeRapido pacote={pacote} onPacote={onPacote} obrigatorio={percentualTributos == null} />

      {percentualTributos == null ? (
        <Cartao>
          <p className="tipo-pequeno text-ink-muted">Confirme o regime acima para ver os preços.</p>
        </Cartao>
      ) : (
        <>
          {/* 2. Resultado (atualiza enquanto digita) */}
          <Cartao className="space-y-3" aria-live="polite">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="tipo-titulo-3 text-ink">Vale participar?</h3>
              <ChipStatus status={consolidado?.status ?? "INCOMPLETO"} />
            </div>

            {resultado ? (
              <p className="tipo-corpo text-ink">{explicarResultado(resultado)}</p>
            ) : (
              <p className="tipo-corpo text-ink-muted">{avisoMargens}</p>
            )}

            {consolidado && consolidado.completo && consolidado.valorTetoTotal > 0 && (
              <>
                <TabelaCenarios cenarios={consolidado.cenarios} mostrarUnitario={false} legenda="Preços do estudo inteiro nos três cenários" />
                <p className="tipo-pequeno text-ink-muted">
                  Custo total {moeda(consolidado.custoTotal)} · Valor do edital {moeda(consolidado.valorTetoTotal)}
                  {produto.itens.length > 1 &&
                    ` · ${consolidado.qtdCompetitivos} item(ns) competitivo(s), ${consolidado.qtdApertados} apertado(s), ${consolidado.qtdInviaveis} inviável(is)`}
                </p>
              </>
            )}

            {sujo && <p className="tipo-pequeno text-warning-ink">Você mudou números que ainda não foram salvos.</p>}

            <details className="tipo-pequeno text-ink-muted">
              <summary className="min-h-11 cursor-pointer py-3 font-bold text-brand-600">Como ler os três preços</summary>
              <ul className="list-disc space-y-1 pl-5">
                <li>
                  <strong className="text-ink">Inicial</strong>: o preço para abrir a disputa, com a maior margem que você quer. Nunca passa do valor do
                  edital.
                </li>
                <li>
                  <strong className="text-ink">Alvo</strong>: onde você gostaria de fechar.
                </li>
                <li>
                  <strong className="text-ink">Piso</strong>: o menor preço que ainda dá a margem mínima. Abaixo dele você perde dinheiro, então não dê lance
                  menor que isso.
                </li>
                <li>
                  “Abaixo do edital” mostra o quanto cada preço fica abaixo do valor que o órgão estimou. No piso, é a folga que você tem para dar lances.
                </li>
              </ul>
            </details>
          </Cartao>

          {/* 3. Margens */}
          <Cartao className="space-y-4">
            <div>
              <h3 className="tipo-titulo-3 text-ink">Suas margens</h3>
              <p className="tipo-pequeno text-ink-muted">
                {produto.margens.origem === "APRENDIDO" &&
                  `Valores que você costuma usar (média de ${produto.margens.amostras} estudo(s) concluído(s)). Pode ajustar.`}
                {produto.margens.origem === "PADRAO" &&
                  "Valores de partida: ajuste ao seu negócio. Depois que você concluir um estudo, o Bidd.IA passa a lembrar das suas margens."}
                {produto.margens.origem === "SALVO" && "Margens salvas neste estudo."}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <Field label="Margem inicial (%)" htmlFor="margem-inicial" hint="Proposta de abertura.">
                <TextInput id="margem-inicial" inputMode="decimal" value={margensTxt.inicial} onChange={(e) => mudarMargem("inicial", e.target.value)} />
              </Field>
              <Field label="Margem alvo (%)" htmlFor="margem-alvo" hint="Onde quer fechar.">
                <TextInput id="margem-alvo" inputMode="decimal" value={margensTxt.alvo} onChange={(e) => mudarMargem("alvo", e.target.value)} />
              </Field>
              <Field label="Margem mínima (%)" htmlFor="margem-piso" hint="Abaixo disso não compensa.">
                <TextInput id="margem-piso" inputMode="decimal" value={margensTxt.piso} onChange={(e) => mudarMargem("piso", e.target.value)} />
              </Field>
              <Field label="Despesas da empresa (%)" htmlFor="margem-despesas" hint="Comissão e administrativo, sobre o custo.">
                <TextInput id="margem-despesas" inputMode="decimal" value={margensTxt.despesas} onChange={(e) => mudarMargem("despesas", e.target.value)} />
              </Field>
            </div>

            {avisoMargens && (
              <p role="alert" className="tipo-pequeno text-danger-ink">
                {avisoMargens}
              </p>
            )}
          </Cartao>

          {/* 4. Itens */}
          {produto.itens.length === 0 ? (
            <Cartao>
              <p className="tipo-corpo text-ink">Nenhum item para calcular.</p>
              <p className="tipo-pequeno text-ink-muted">
                Marque os lotes que você quer disputar na aba Financeiro e abra esta aba de novo.
              </p>
            </Cartao>
          ) : (
            produto.itens.map((it, i) => {
              const l = linhas[i];
              const r = resultado?.itens[i] ?? null;
              const origem = l.mudou ? "DIGITADO" : it.fonteCusto;
              return (
                <Cartao key={it.itemIndex} className="space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="tipo-legenda text-ink-muted">
                        {it.itemGlobal ? "Estudo pelo valor global do edital" : `Item ${it.numero ?? i + 1}`}
                        {it.lote ? ` · Lote ${it.lote}` : ""}
                      </p>
                      <p className="tipo-corpo-forte break-words text-ink">{it.descricao}</p>
                      <p className="tipo-pequeno text-ink-muted">
                        {it.quantidade} {it.unidade}
                        {precisaReferencia(it)
                          ? it.valorTotalReferencia > 0
                            ? ` · valor de referência informado por você: ${moeda(it.valorTotalReferencia)}`
                            : " · o edital não divulga o valor deste item"
                          : ` · edital: ${moeda(it.valorUnitarioReferencia)} por unidade (${moeda(it.valorTotalReferencia)} no total)`}
                      </p>
                    </div>
                    {r && <ChipStatus status={r.status} />}
                  </div>

                  {origem === "HISTORICO" && it.sugestao && (
                    <div className="rounded-tile bg-tint p-3">
                      <Chip tom="info" icone={Sparkles}>
                        Sugerido pelo seu histórico
                      </Chip>
                      <p className="tipo-pequeno mt-2 text-tint-ink">
                        Parecido com “{it.sugestao.rotulo}” ({Math.round(it.sugestao.similaridade * 100)}% igual, em {formatDate(it.sugestao.atualizadoEm)}
                        {it.sugestao.ocorrencias > 1 ? `, visto em ${it.sugestao.ocorrencias} estudos` : ""}).
                        {it.sugestao.ajustouPorQuantidade ? " Frete e ICMS-ST foram ajustados à quantidade deste edital." : ""} Confira os valores antes de
                        salvar.
                      </p>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                    <Field label="Custo de compra por unidade (R$)" htmlFor={`custo-${i}`}>
                      <TextInput id={`custo-${i}`} inputMode="decimal" placeholder="0,00" value={l.custo} onChange={(e) => mudarLinha(i, "custo", e.target.value)} />
                    </Field>
                    <Field label="Frete do item todo (R$)" htmlFor={`frete-${i}`} hint="Valor total, não por unidade.">
                      <TextInput id={`frete-${i}`} inputMode="decimal" placeholder="0,00" value={l.frete} onChange={(e) => mudarLinha(i, "frete", e.target.value)} />
                    </Field>
                    <Field label="ICMS-ST / DIFAL do item todo (R$)" htmlFor={`icms-${i}`} hint="Valor total, se houver.">
                      <TextInput id={`icms-${i}`} inputMode="decimal" placeholder="0,00" value={l.icms} onChange={(e) => mudarLinha(i, "icms", e.target.value)} />
                    </Field>
                    <Field label="Fornecedor (opcional)" htmlFor={`forn-${i}`} hint="Ajuda o Bidd.IA a lembrar.">
                      <TextInput id={`forn-${i}`} maxLength={120} value={l.fornecedor} onChange={(e) => mudarLinha(i, "fornecedor", e.target.value)} />
                    </Field>
                  </div>

                  {precisaReferencia(it) && (
                    <Field
                      label="Valor de referência por unidade (R$)"
                      htmlFor={`ref-${i}`}
                      hint="O órgão não divulgou o valor. Se você souber (ou estimar), informe — sem ele não dá para dizer se vale participar."
                    >
                      <TextInput id={`ref-${i}`} inputMode="decimal" placeholder="0,00" value={l.referencia} onChange={(e) => mudarLinha(i, "referencia", e.target.value)} />
                    </Field>
                  )}

                  {r && r.status !== "SEM_CUSTO" ? (
                    <TabelaCenarios cenarios={r.cenarios} mostrarUnitario legenda={`Preços do item ${it.descricao} nos três cenários`} />
                  ) : (
                    <p className="tipo-pequeno text-ink-muted">Informe o custo de compra para ver os preços deste item.</p>
                  )}
                </Cartao>
              );
            })
          )}

          {/* 5. Ações */}
          <Cartao className="space-y-3">
            {erro && (
              <p role="alert" className="tipo-pequeno text-danger-ink">
                {erro}
              </p>
            )}
            {motivoNaoConcluir && <p className="tipo-pequeno text-ink-muted">Para concluir: {motivoNaoConcluir}</p>}
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => salvar("rascunho")} loading={salvando === "rascunho"} disabled={salvando !== null || !sujo}>
                Salvar rascunho
              </Button>
              <Button onClick={() => salvar("concluir")} loading={salvando === "concluir"} disabled={salvando !== null || motivoNaoConcluir != null}>
                Concluir estudo
              </Button>
            </div>
            <p className="tipo-pequeno text-ink-muted">
              Ao concluir, o Bidd.IA guarda os custos e passa a usá-los como sugestão nos próximos editais com produtos parecidos.
            </p>
          </Cartao>

          {/* 6. Relatório */}
          {concluidoEm && !sujo && estudo && (
            <Cartao className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="tipo-corpo-forte text-ink">Estudo concluído em {formatDateTime(concluidoEm)}</p>
                  <p className="tipo-pequeno text-ink-muted">O relatório reúne tudo e pode ser baixado em PDF.</p>
                </div>
                <Button variant="secondary" size="compacto" onClick={() => setRelatorioAberto((v) => !v)}>
                  {relatorioAberto ? "Esconder relatório" : "Ver relatório e PDF"}
                </Button>
              </div>
              {relatorioAberto && <EtapaRelatorio key={concluidoEm} estudo={estudo} />}
              <Link href={`/estudo-viabilidade/${estudo.id}`} className="tipo-pequeno inline-flex min-h-11 items-center font-bold text-brand-600">
                Abrir no passo a passo completo →
              </Link>
            </Cartao>
          )}
        </>
      )}
    </div>
  );
}
