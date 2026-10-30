"use client";

import { useEffect, useState } from "react";
import { Loader2, Package, Wrench } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Cartao } from "@/components/ui/Cartao";
import { Chip } from "@/components/ui/Chip";
import { EstudoProdutoAba } from "@/components/estudo-viabilidade/aba/EstudoProdutoAba";
import { EstudoServicoAba } from "@/components/estudo-viabilidade/aba/EstudoServicoAba";
import type { PacoteAba } from "@/lib/estudo-aba-tipos";
import type { RamoEstudo } from "@/lib/estudo-viabilidade";

/**
 * Aba "Viabilidade" do edital. O estudo acontece aqui mesmo, com o edital já ligado:
 *  - Produtos: uma tela só com custos por item e os preços Inicial / Alvo / Piso ao vivo.
 *  - Serviços: as etapas do estudo completo, empilhadas.
 * O Bidd.IA guarda os custos de cada estudo concluído e usa como sugestão nos próximos.
 */
export function ViabilidadeTab({ editalId }: { editalId: string }) {
  const [pacote, setPacote] = useState<PacoteAba | null>(null);
  const [erro, setErro] = useState(false);
  const [criando, setCriando] = useState<RamoEstudo | null>(null);
  const [erroCriar, setErroCriar] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    fetch(`/api/editais/${editalId}/estudo`)
      .then(async (r) => {
        if (!r.ok) throw new Error();
        const dados = (await r.json()) as PacoteAba;
        if (!cancelado) setPacote(dados);
      })
      .catch(() => {
        if (!cancelado) setErro(true);
      });
    return () => {
      cancelado = true;
    };
  }, [editalId]);

  async function criar(ramo: RamoEstudo) {
    setCriando(ramo);
    setErroCriar(null);
    try {
      const res = await fetch(`/api/editais/${editalId}/estudo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ramo }),
      });
      const dados = await res.json();
      if (!res.ok) {
        setErroCriar(dados.error ?? "Não foi possível criar o estudo.");
        return;
      }
      setPacote(dados as PacoteAba);
    } catch {
      setErroCriar("Sem conexão. Tente de novo.");
    } finally {
      setCriando(null);
    }
  }

  if (erro) return <p className="tipo-pequeno text-danger-ink">Não foi possível carregar o estudo de viabilidade.</p>;
  if (!pacote) {
    return (
      <div className="flex justify-center py-10 text-ink-muted">
        <Loader2 className="h-5 w-5 animate-spin" aria-label="Carregando" />
      </div>
    );
  }

  const estudo = pacote.estudo;

  if (!estudo) {
    const sugerido = pacote.ramoSugerido;
    return (
      <Cartao className="space-y-4">
        <div>
          <h3 className="tipo-titulo-3 text-ink">Vale a pena participar deste edital?</h3>
          <p className="tipo-corpo mt-1 text-ink-muted">
            O estudo calcula quanto custa entregar, quanto vai de imposto e qual é o menor preço que ainda dá lucro. Cada estudo concluído ensina o
            Bidd.IA: nos próximos editais ele já traz seus custos e suas margens preenchidos.
          </p>
        </div>

        <p className="tipo-corpo-forte text-ink">Este edital é de:</p>
        <div className="grid gap-3 md:grid-cols-2">
          {(
            [
              { ramo: "PRODUTO", titulo: "Produtos", texto: "Você compra e revende: custo de compra, frete e impostos.", Icone: Package },
              { ramo: "SERVICO", titulo: "Serviços", texto: "Você presta o serviço: equipe, salários, encargos e custos mensais.", Icone: Wrench },
            ] as const
          ).map(({ ramo, titulo, texto, Icone }) => (
            <div key={ramo} className="flex flex-col gap-3 rounded-tile border border-border p-4">
              <div className="flex items-center gap-2">
                <Icone className="h-5 w-5 text-brand-600" aria-hidden />
                <p className="tipo-corpo-forte text-ink">{titulo}</p>
                {sugerido === ramo && <Chip tom="info">Sugerido para este edital</Chip>}
              </div>
              <p className="tipo-pequeno text-ink-muted">{texto}</p>
              <Button variant={sugerido === ramo || sugerido == null ? "primary" : "secondary"} loading={criando === ramo} disabled={criando !== null} onClick={() => criar(ramo)}>
                Começar estudo de {titulo.toLowerCase()}
              </Button>
            </div>
          ))}
        </div>

        {erroCriar && (
          <p role="alert" className="tipo-pequeno text-danger-ink">
            {erroCriar}
          </p>
        )}
      </Cartao>
    );
  }

  if (estudo.ramo === "PRODUTO" && pacote.produto) {
    return <EstudoProdutoAba key={estudo.id} pacote={pacote} onPacote={setPacote} />;
  }
  return <EstudoServicoAba pacote={pacote} onPacote={setPacote} />;
}
