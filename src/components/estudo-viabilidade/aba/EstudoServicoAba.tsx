"use client";

import Link from "next/link";
import { Cartao } from "@/components/ui/Cartao";
import { EtapaRequisitos } from "@/components/estudo-viabilidade/EtapaRequisitos";
import { EtapaTributos } from "@/components/estudo-viabilidade/EtapaTributos";
import { EtapaCustos } from "@/components/estudo-viabilidade/EtapaCustos";
import { EtapaCalculo } from "@/components/estudo-viabilidade/EtapaCalculo";
import { EtapaRelatorio } from "@/components/estudo-viabilidade/EtapaRelatorio";
import type { PacoteAba } from "@/lib/estudo-aba-tipos";
import type { EstudoViabilidadeDetail } from "@/lib/types";

/**
 * Estudo de SERVIÇOS dentro da aba: usa as mesmas etapas já testadas do estudo completo (equipe, encargos,
 * custos mensais e DRE), empilhadas aqui para você não precisar sair do edital. O edital já vem ligado.
 */
export function EstudoServicoAba({ pacote, onPacote }: { pacote: PacoteAba; onPacote: (p: PacoteAba) => void }) {
  const estudo = pacote.estudo as EstudoViabilidadeDetail;
  const atualizar = (novo: EstudoViabilidadeDetail) => onPacote({ ...pacote, estudo: novo });

  return (
    <div className="space-y-6">
      <Cartao>
        <p className="tipo-corpo text-ink">
          Estudo de serviços: o Bidd.IA lê as exigências do edital, você informa salários e custos, e ele monta o resultado mês a mês.
        </p>
        <Link href={`/estudo-viabilidade/${estudo.id}`} className="tipo-pequeno mt-1 inline-flex min-h-11 items-center font-bold text-brand-600">
          Abrir em tela cheia →
        </Link>
      </Cartao>

      <EtapaRequisitos estudo={estudo} onUpdated={atualizar} />
      {estudo.requisitosConfirmadoEm && <EtapaTributos estudo={estudo} onUpdated={atualizar} />}
      {estudo.tributosConfirmadoEm && <EtapaCustos estudo={estudo} onUpdated={atualizar} />}
      {estudo.custosConfirmadoEm && <EtapaCalculo estudo={estudo} onUpdated={atualizar} />}
      {estudo.calculoConfirmadoEm && <EtapaRelatorio estudo={estudo} />}
    </div>
  );
}
