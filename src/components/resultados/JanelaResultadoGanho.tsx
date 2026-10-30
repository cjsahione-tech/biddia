"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Field, Select, TextInput } from "@/components/ui/Field";
import { Janela } from "@/components/ui/Janela";
import { formatBRL } from "@/lib/format";
import { escreverNumeroBR, lerNumeroBR } from "@/lib/numero-br";
import {
  PAPEIS_COLUNA,
  conferirTotais,
  descontoSobreReferencia,
  letraColuna,
  somaDosItens,
  type ItemResultado,
  type LeituraPlanilha,
  type Mapeamento,
  type PapelColuna,
  type ResultadoEditalDados,
} from "@/lib/planilha-resultado";

// Mesmo teto do servidor (corpo em base64 contra o limite de ~4,5MB da Vercel).
const TAMANHO_MAXIMO_BYTES = 3 * 1024 * 1024;
const ITENS_NA_PREVIA = 6;

const formatarQuantidade = (q: number) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(q);
const formatarPercentual = (p: number) => `${p.toFixed(1).replace(".", ",")}%`;

async function arquivoParaBase64(arquivo: File): Promise<string> {
  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  let binario = "";
  const bloco = 0x8000;
  for (let i = 0; i < bytes.length; i += bloco) {
    binario += String.fromCharCode.apply(null, bytes.subarray(i, i + bloco) as unknown as number[]);
  }
  return btoa(binario);
}

/**
 * Janela do edital ganho: pergunta o valor homologado e (opcionalmente) recebe a planilha da proposta final.
 * A planilha é lida pelo servidor, o usuário confere o que foi lido (e troca a coluna se precisar) e só então salva.
 *
 *  - modo "mover": aberta ao arrastar um card para "Ganhas". Ao confirmar, `onSalvo` move o card.
 *  - modo "registrar": aberta pela página Resultados para registrar ou corrigir o resultado, sem mover nada.
 *
 * Monte esta janela só quando for usá-la (o estado começa do zero a cada abertura).
 */
export function JanelaResultadoGanho({
  editalId,
  tituloEdital,
  valorReferencia,
  etapaAtualRotulo,
  modo,
  onFechar,
  onSalvo,
}: {
  editalId: string;
  tituloEdital: string;
  valorReferencia: number | null;
  /** Preenchido quando o card vem de uma coluna "estranha" para um ganho: pede uma confirmação extra. */
  etapaAtualRotulo?: string | null;
  modo: "mover" | "registrar";
  onFechar: () => void;
  onSalvo: () => void | Promise<void>;
}) {
  const [valorTexto, setValorTexto] = useState("");
  const [existente, setExistente] = useState<ResultadoEditalDados | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [arquivo, setArquivo] = useState<{ nome: string; base64: string } | null>(null);
  const [leitura, setLeitura] = useState<LeituraPlanilha | null>(null);
  const [lendo, setLendo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [confirmouOrigem, setConfirmouOrigem] = useState(false);
  const entradaArquivo = useRef<HTMLInputElement>(null);
  const erroRef = useRef<HTMLParagraphElement>(null);
  const pedidoAtual = useRef(0);

  // A janela (Janela.tsx) devolve o foco para ela sempre que `onFechar` muda de identidade; manter essa função
  // estável evita que o campo perca o cursor a cada letra digitada.
  const fecharRef = useRef(onFechar);
  const ocupadoRef = useRef(false);
  useEffect(() => {
    fecharRef.current = onFechar;
  });
  const fechar = useCallback(() => {
    if (!ocupadoRef.current) fecharRef.current();
  }, []);

  // A janela rola por dentro no celular: leva a mensagem de erro para a vista quando ela aparece.
  useEffect(() => {
    if (erro) erroRef.current?.scrollIntoView({ block: "nearest" });
  }, [erro]);

  // Se o edital já tem resultado (corrigindo, ou card que voltou para Ganhas), começa com ele preenchido.
  useEffect(() => {
    let cancelado = false;
    fetch(`/api/editais/${editalId}/resultado`)
      .then(async (r) => (r.ok ? ((await r.json()) as { resultado: ResultadoEditalDados | null }) : null))
      .then((dados) => {
        if (cancelado) return;
        if (dados?.resultado) {
          setExistente(dados.resultado);
          setValorTexto(escreverNumeroBR(dados.resultado.valorHomologado));
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelado) setCarregando(false);
      });
    return () => {
      cancelado = true;
    };
  }, [editalId]);

  const lerNoServidor = useCallback(
    async (alvo: { nome: string; base64: string }, ajuste?: Mapeamento) => {
      const numeroDoPedido = ++pedidoAtual.current;
      setLendo(true);
      setErro(null);
      try {
        const res = await fetch(`/api/editais/${editalId}/resultado/ler`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ arquivoBase64: alvo.base64, nomeArquivo: alvo.nome, ...(ajuste ? { ajuste } : {}) }),
        });
        const dados = await res.json().catch(() => ({}));
        if (numeroDoPedido !== pedidoAtual.current) return; // chegou uma resposta mais nova
        if (!res.ok) {
          setLeitura(null);
          setErro(dados.error ?? "Não foi possível ler essa planilha.");
          return;
        }
        setLeitura(dados.leitura as LeituraPlanilha);
      } catch {
        if (numeroDoPedido === pedidoAtual.current) {
          setLeitura(null);
          setErro("Sem conexão. Tente de novo.");
        }
      } finally {
        if (numeroDoPedido === pedidoAtual.current) setLendo(false);
      }
    },
    [editalId]
  );

  async function aoEscolherArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const escolhido = e.target.files?.[0];
    e.target.value = ""; // permite escolher o mesmo arquivo de novo
    if (!escolhido) return;
    if (escolhido.size > TAMANHO_MAXIMO_BYTES) {
      setErro(`Arquivo muito grande. O limite é de ${TAMANHO_MAXIMO_BYTES / 1024 / 1024}MB.`);
      return;
    }
    const novo = { nome: escolhido.name, base64: await arquivoParaBase64(escolhido) };
    setArquivo(novo);
    setLeitura(null);
    await lerNoServidor(novo);
  }

  function removerArquivo() {
    pedidoAtual.current++;
    setArquivo(null);
    setLeitura(null);
    setLendo(false);
    setErro(null);
  }

  function trocarColuna(papel: PapelColuna, valor: string) {
    if (!arquivo || !leitura) return;
    const ajuste: Mapeamento = { ...leitura.mapeamento, [papel]: valor === "" ? null : Number(valor) };
    void lerNoServidor(arquivo, ajuste);
  }

  const valor = lerNumeroBR(valorTexto);
  const valorInvalido = valorTexto.trim() !== "" && valor == null;
  const itensParaSalvar: ItemResultado[] = arquivo ? (leitura?.itens ?? []) : (existente?.itens ?? []);
  const planilhaPendente = arquivo != null && (leitura == null || leitura.itens.length === 0 || leitura.faltando.length > 0);
  const precisaConfirmarOrigem = modo === "mover" && !!etapaAtualRotulo;
  const podeSalvar =
    !carregando && !lendo && !salvando && valor != null && valor > 0 && !planilhaPendente && (!precisaConfirmarOrigem || confirmouOrigem);

  const conferencia = leitura && valor && valor > 0 ? conferirTotais(valor, leitura.itens) : null;
  const desconto = descontoSobreReferencia(valorReferencia, valor && valor > 0 ? valor : null);

  async function salvar() {
    if (!podeSalvar || valor == null) return;
    ocupadoRef.current = true;
    setSalvando(true);
    setErro(null);
    try {
      const res = await fetch(`/api/editais/${editalId}/resultado`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          valorHomologado: valor,
          itens: itensParaSalvar.map((i) => ({
            numero: i.numero,
            descricao: i.descricao,
            unidade: i.unidade,
            quantidade: i.quantidade,
            valorUnitario: i.valorUnitario,
          })),
          ...(arquivo ? { arquivo: { nome: arquivo.nome, base64: arquivo.base64 } } : {}),
        }),
      });
      const dados = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErro(dados.error ?? "Não foi possível salvar o resultado.");
        return;
      }
      await onSalvo();
    } catch {
      setErro("Sem conexão. Tente de novo.");
    } finally {
      ocupadoRef.current = false;
      setSalvando(false);
    }
  }

  const precisaAjustarColunas = leitura != null && leitura.faltando.length > 0;
  const nomePapelFaltando = (p: PapelColuna) => PAPEIS_COLUNA.find((x) => x.papel === p)?.rotulo ?? p;

  return (
    <Janela
      aberta
      onFechar={fechar}
      titulo={modo === "mover" ? "Edital ganho" : "Resultado do edital"}
      descricao={tituloEdital}
      rodape={
        <>
          <Button variant="secondary" onClick={fechar} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={salvar} loading={salvando} disabled={!podeSalvar}>
            {modo === "mover" ? "Confirmar e mover para Ganhas" : "Salvar resultado"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {precisaConfirmarOrigem && (
          <div className="rounded-tile bg-warning-bg p-3 text-warning-ink">
            <p className="tipo-pequeno flex items-start gap-2 font-bold">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>
                Este edital está em “{etapaAtualRotulo}”. Normalmente um edital só chega em Ganhas depois da disputa.
              </span>
            </p>
            <label className="mt-2 flex min-h-11 cursor-pointer items-center gap-3 text-[14px] font-bold">
              <input
                type="checkbox"
                checked={confirmouOrigem}
                onChange={(e) => setConfirmouOrigem(e.target.checked)}
                className="h-5 w-5 shrink-0 accent-brand-600"
              />
              Confirmo que este edital foi ganho
            </label>
          </div>
        )}

        <Field
          label="Qual o valor homologado?"
          htmlFor="valor-homologado"
          hint={valorReferencia != null ? `Valor do edital: ${formatBRL(valorReferencia)}` : "Valor final do contrato, como saiu na homologação."}
        >
          <TextInput
            id="valor-homologado"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0,00"
            value={valorTexto}
            onChange={(e) => setValorTexto(e.target.value)}
            aria-invalid={valorInvalido}
            disabled={carregando}
          />
        </Field>
        {valorInvalido && (
          <p role="alert" className="tipo-pequeno -mt-3 text-danger-ink">
            Digite só números, por exemplo 12.345,67.
          </p>
        )}
        {desconto != null && !valorInvalido && (
          <p className="tipo-pequeno -mt-3 text-ink-muted">
            {desconto >= 0
              ? `${formatarPercentual(desconto)} abaixo do valor do edital.`
              : `${formatarPercentual(Math.abs(desconto))} acima do valor do edital.`}
          </p>
        )}

        <div>
          <p className="block text-[13px] font-bold text-ink">Planilha da proposta final</p>
          <p className="tipo-pequeno mt-1 text-ink-muted">
            Excel (.xlsx) ou CSV com os itens, as quantidades e os valores unitários. O sistema lê as colunas sozinho e mostra o que entendeu
            para você conferir. Se não tiver agora, dá para anexar depois pela página Resultados.
          </p>

          <input
            ref={entradaArquivo}
            type="file"
            accept=".xlsx,.xlsm,.csv,.tsv,.txt"
            className="sr-only"
            tabIndex={-1}
            aria-label="Escolher planilha da proposta final"
            onChange={aoEscolherArquivo}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => entradaArquivo.current?.click()} disabled={salvando || lendo}>
              <Upload className="h-4 w-4" aria-hidden />
              {arquivo ? "Trocar planilha" : "Anexar planilha"}
            </Button>
            {arquivo && (
              <Button variant="ghost" onClick={removerArquivo} disabled={salvando}>
                <X className="h-4 w-4" aria-hidden />
                Tirar
              </Button>
            )}
          </div>

          {!arquivo && existente && (
            <p className="tipo-pequeno mt-2 flex items-center gap-2 text-ink-muted">
              <FileSpreadsheet className="h-4 w-4 shrink-0" aria-hidden />
              <span className="min-w-0">
                {existente.nomeArquivo ? `Planilha atual: ${existente.nomeArquivo}` : "Resultado salvo sem planilha"}
                {existente.itens.length > 0 ? ` · ${existente.itens.length} ite${existente.itens.length === 1 ? "m" : "ns"}` : ""}
              </span>
            </p>
          )}
          {arquivo && (
            <p className="tipo-pequeno mt-2 flex items-center gap-2 text-ink">
              <FileSpreadsheet className="h-4 w-4 shrink-0 text-brand-600" aria-hidden />
              <span className="min-w-0 break-all">{arquivo.nome}</span>
            </p>
          )}
          {lendo && <p className="tipo-pequeno mt-2 text-ink-muted">Lendo a planilha…</p>}

          {leitura && !lendo && (
            <div className="mt-3 rounded-tile border border-border p-3" aria-live="polite">
              <div className="flex flex-wrap items-center gap-2">
                {leitura.itens.length > 0 && leitura.faltando.length === 0 ? (
                  <Chip tom="sucesso" icone={CheckCircle2}>
                    {leitura.itens.length} ite{leitura.itens.length === 1 ? "m lido" : "ns lidos"}
                  </Chip>
                ) : (
                  <Chip tom="erro" icone={AlertTriangle}>
                    Não consegui ler todos os dados
                  </Chip>
                )}
                {leitura.itens.length > 0 && (
                  <span className="tipo-pequeno text-ink-muted">
                    Soma dos itens: <strong className="text-ink">{formatBRL(somaDosItens(leitura.itens))}</strong>
                  </span>
                )}
              </div>

              {precisaAjustarColunas && (
                <p role="alert" className="tipo-pequeno mt-2 text-danger-ink">
                  Não achei a coluna de {leitura.faltando.map((p) => nomePapelFaltando(p).toLowerCase()).join(", ")}. Escolha abaixo qual coluna da
                  planilha é essa.
                </p>
              )}
              {leitura.itens.length === 0 && !precisaAjustarColunas && (
                <p role="alert" className="tipo-pequeno mt-2 text-danger-ink">
                  Não encontrei nenhum item válido nessa planilha. Confira as colunas abaixo.
                </p>
              )}

              {conferencia?.divergente && (
                <p className="tipo-pequeno mt-2 flex items-start gap-2 text-warning-ink">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <span>
                    A soma dos itens ({formatBRL(conferencia.somaItens)}) é {formatarPercentual(conferencia.percentual ?? 0)} diferente do valor
                    homologado. Isso pode ser normal (por exemplo, se só alguns lotes foram ganhos). Confira antes de salvar.
                  </span>
                </p>
              )}

              {leitura.itens.length > 0 && (
                <ul className="mt-2 divide-y divide-border">
                  {leitura.itens.slice(0, ITENS_NA_PREVIA).map((item, i) => (
                    <li key={`${i}-${item.descricao}`} className="py-1.5">
                      <p className="tipo-pequeno line-clamp-2 text-ink">
                        {item.numero != null ? `${item.numero}. ` : ""}
                        {item.descricao}
                      </p>
                      <p className="tipo-legenda tabular-nums text-ink-muted">
                        {formatarQuantidade(item.quantidade)} {item.unidade} × {formatBRL(item.valorUnitario)} ={" "}
                        <span className="font-bold text-ink">{formatBRL(item.valorTotal)}</span>
                      </p>
                    </li>
                  ))}
                  {leitura.itens.length > ITENS_NA_PREVIA && (
                    <li className="tipo-pequeno py-1.5 text-ink-muted">…e mais {leitura.itens.length - ITENS_NA_PREVIA} itens.</li>
                  )}
                </ul>
              )}

              <details className="mt-2" open={precisaAjustarColunas || leitura.itens.length === 0}>
                <summary className="tipo-pequeno flex min-h-11 cursor-pointer items-center font-bold text-brand-600">Conferir as colunas lidas</summary>
                <div className="mt-1 grid gap-3 md:grid-cols-2">
                  {PAPEIS_COLUNA.map(({ papel, rotulo, obrigatorio }) => (
                    <Field key={papel} label={obrigatorio ? rotulo : `${rotulo} (opcional)`} htmlFor={`coluna-${papel}`}>
                      <Select
                        id={`coluna-${papel}`}
                        value={leitura.mapeamento[papel] == null ? "" : String(leitura.mapeamento[papel])}
                        onChange={(e) => trocarColuna(papel, e.target.value)}
                        disabled={lendo}
                      >
                        <option value="">— nenhuma —</option>
                        {leitura.colunas.map((c) => (
                          <option key={c.indice} value={c.indice}>
                            {letraColuna(c.indice)} · {c.titulo}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  ))}
                </div>
                <p className="tipo-pequeno mt-2 text-ink-muted">
                  Se não houver coluna de valor unitário, o sistema calcula dividindo o valor total pela quantidade.
                </p>
              </details>

              {leitura.avisos.length > 0 && (
                <details className="mt-1">
                  <summary className="tipo-pequeno flex min-h-11 cursor-pointer items-center font-bold text-ink-muted">
                    Observações da leitura ({leitura.avisos.length})
                  </summary>
                  <ul className="tipo-pequeno list-disc space-y-1 pl-5 text-ink-muted">
                    {leitura.avisos.map((aviso, i) => (
                      <li key={i}>{aviso}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}

        </div>

        {erro && (
          <p ref={erroRef} role="alert" className="tipo-pequeno font-bold text-danger-ink">
            {erro}
          </p>
        )}
      </div>
    </Janela>
  );
}
