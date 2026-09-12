"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, TextInput } from "@/components/ui/Field";
import { formatBRL } from "@/lib/format";
import {
  ANEXOS_SIMPLES,
  ANEXO_LABEL,
  REGIMES_TRIBUTARIOS,
  REGIME_LABEL,
  type RegimeTributario,
  type AnexoSimples,
  type AliquotasResolvidas,
} from "@/lib/tributos";
import type { EstudoViabilidadeDetail } from "@/lib/types";

const selectClass =
  "mt-1.5 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";

const DETALHE_LABEL: Record<string, string> = {
  faixa: "Faixa",
  aliquotaNominal: "Alíquota nominal",
  parcelaDeduzir: "Parcela a deduzir",
  issOuIcms: "ISS/ICMS",
  pis: "PIS",
  cofins: "COFINS",
  irpjCsll: "IRPJ + CSLL",
};

/** Etapa 3: escolha do regime tributário (Simples/Presumido/Real), com Anexo e RBT12
 * quando Simples Nacional — alíquotas vêm sempre da tabela de parâmetros da empresa. */
export function EtapaTributos({
  estudo,
  onUpdated,
}: {
  estudo: EstudoViabilidadeDetail;
  onUpdated: (estudo: EstudoViabilidadeDetail) => void;
}) {
  const [editando, setEditando] = useState(false);

  if (estudo.tributosConfirmadoEm && !editando) {
    return <ResumoTributos estudo={estudo} onEditar={() => setEditando(true)} />;
  }

  return (
    <FormularioTributos
      estudo={estudo}
      onSalvo={(novoEstudo) => {
        onUpdated(novoEstudo);
        setEditando(false);
      }}
    />
  );
}

function ResumoTributos({ estudo, onEditar }: { estudo: EstudoViabilidadeDetail; onEditar: () => void }) {
  const aliquotas: AliquotasResolvidas | null = estudo.aliquotasJson ? JSON.parse(estudo.aliquotasJson) : null;
  if (!aliquotas) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 rounded-xl bg-accent/10 px-4 py-2.5 text-sm text-accent">
        <span className="inline-flex items-center gap-1.5 font-medium">
          <CheckCircle2 className="h-4 w-4" /> Regime tributário confirmado
        </span>
        <button onClick={onEditar} className="inline-flex items-center gap-1 text-xs font-medium hover:underline">
          <Pencil className="h-3 w-3" /> Editar novamente
        </button>
      </div>

      <div className="rounded-2xl border border-border bg-surface/50 p-5">
        <p className="text-sm font-semibold text-foreground">{REGIME_LABEL[aliquotas.regime]}</p>
        {aliquotas.regime === "SIMPLES_NACIONAL" && aliquotas.anexoSimples && (
          <p className="mt-1 text-sm text-muted">
            {ANEXO_LABEL[aliquotas.anexoSimples]} — RBT12 {formatBRL(aliquotas.rbt12 ?? 0)}
          </p>
        )}

        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {Object.entries(aliquotas.detalhes).map(([chave, valor]) => (
            <div key={chave}>
              <p className="text-xs text-muted">{DETALHE_LABEL[chave] ?? chave}</p>
              <p className="mt-0.5 text-sm font-medium text-foreground">
                {chave === "parcelaDeduzir" ? formatBRL(valor) : chave === "faixa" ? valor : `${valor.toFixed(2)}%`}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-4 border-t border-border pt-4">
          <p className="text-xs text-muted">Alíquota total efetiva sobre a receita</p>
          <p className="mt-0.5 text-xl font-semibold text-brand">{aliquotas.aliquotaTotalEfetiva.toFixed(2)}%</p>
        </div>
      </div>
    </div>
  );
}

function FormularioTributos({
  estudo,
  onSalvo,
}: {
  estudo: EstudoViabilidadeDetail;
  onSalvo: (estudo: EstudoViabilidadeDetail) => void;
}) {
  const [regime, setRegime] = useState<RegimeTributario | "">(estudo.regimeTributario ?? "");
  const [anexo, setAnexo] = useState<AnexoSimples | "">(estudo.anexoSimples ?? "");
  const [rbt12, setRbt12] = useState(estudo.rbt12 != null ? String(estudo.rbt12) : "");
  const [carregandoPadrao, setCarregandoPadrao] = useState(!estudo.regimeTributario);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    // Só pré-preenche a partir do cadastro da empresa se este estudo ainda não tinha
    // nada definido (carregandoPadrao já inicializa como false nesse caso) — não
    // sobrescreve uma escolha já feita, inclusive numa simulação que diverge do regime
    // padrão da empresa de propósito.
    if (estudo.regimeTributario) return;
    fetch("/api/company")
      .then((r) => r.json())
      .then((data) => {
        const c = data.company;
        if (c?.regimeTributarioPadrao) setRegime(c.regimeTributarioPadrao);
        if (c?.anexoSimplesPadrao) setAnexo(c.anexoSimplesPadrao);
        if (c?.rbt12Padrao != null) setRbt12(String(c.rbt12Padrao));
      })
      .finally(() => setCarregandoPadrao(false));
  }, [estudo.regimeTributario]);

  async function confirmar() {
    if (!regime) {
      setErro("Selecione o regime tributário.");
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      const res = await fetch(`/api/estudos/${estudo.id}/tributos`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          regimeTributario: regime,
          anexoSimples: regime === "SIMPLES_NACIONAL" ? anexo || null : null,
          rbt12: regime === "SIMPLES_NACIONAL" && rbt12 ? Number(rbt12) : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErro(data.error ?? "Não foi possível salvar o regime tributário.");
        return;
      }
      onSalvo(data.estudo);
    } finally {
      setSalvando(false);
    }
  }

  if (carregandoPadrao) {
    return (
      <div className="flex justify-center py-10 text-muted">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Field label="Regime tributário" htmlFor="regime">
        <select
          id="regime"
          value={regime}
          onChange={(e) => setRegime(e.target.value as RegimeTributario)}
          className={selectClass}
        >
          <option value="">Selecione</option>
          {REGIMES_TRIBUTARIOS.map((r) => (
            <option key={r.key} value={r.key}>
              {r.label}
            </option>
          ))}
        </select>
      </Field>

      {regime === "SIMPLES_NACIONAL" && (
        <div className="grid grid-cols-2 gap-4">
          <Field label="Anexo" htmlFor="anexo">
            <select id="anexo" value={anexo} onChange={(e) => setAnexo(e.target.value as AnexoSimples)} className={selectClass}>
              <option value="">Selecione</option>
              {ANEXOS_SIMPLES.map((a) => (
                <option key={a.key} value={a.key}>
                  {a.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="RBT12 (R$)" htmlFor="rbt12" hint="Faturamento bruto dos últimos 12 meses">
            <TextInput
              id="rbt12"
              type="number"
              min={0}
              step={0.01}
              value={rbt12}
              onChange={(e) => setRbt12(e.target.value)}
            />
          </Field>
        </div>
      )}

      {erro && <p className="text-xs text-danger">{erro}</p>}

      <div className="flex justify-end">
        <Button onClick={confirmar} loading={salvando}>
          Confirmar e continuar
        </Button>
      </div>
    </div>
  );
}
