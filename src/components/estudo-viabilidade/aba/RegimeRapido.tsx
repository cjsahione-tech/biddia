"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Cartao } from "@/components/ui/Cartao";
import { Field, Select, TextInput } from "@/components/ui/Field";
import { ANEXOS_SIMPLES, ANEXO_LABEL, REGIMES_TRIBUTARIOS, REGIME_LABEL, type AnexoSimples, type RegimeTributario } from "@/lib/tributos";
import { escreverNumeroBR, lerNumeroBR } from "@/lib/numero-br";
import { formatBRL } from "@/lib/format";
import type { PacoteAba } from "@/lib/estudo-aba-tipos";

/**
 * Regime de impostos do estudo, na própria aba. Normalmente já vem preenchido pelo cadastro da empresa
 * (aparece só uma linha de resumo); se o cadastro não tem regime, mostra o formulário.
 */
export function RegimeRapido({
  pacote,
  onPacote,
  obrigatorio,
}: {
  pacote: PacoteAba;
  onPacote: (p: PacoteAba) => void;
  /** true = ainda não há regime confirmado: o formulário já abre. */
  obrigatorio: boolean;
}) {
  const estudo = pacote.estudo;
  const aliquotas = pacote.produto?.aliquotas ?? null;
  const [aberto, setAberto] = useState(obrigatorio);
  const [regime, setRegime] = useState<RegimeTributario | "">(estudo?.regimeTributario ?? pacote.empresa.regimeTributarioPadrao ?? "");
  const [anexo, setAnexo] = useState<AnexoSimples | "">(estudo?.anexoSimples ?? pacote.empresa.anexoSimplesPadrao ?? "");
  const [rbt12, setRbt12] = useState(escreverNumeroBR(estudo?.rbt12 ?? pacote.empresa.rbt12Padrao));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function confirmar() {
    if (!regime) {
      setErro("Escolha o regime tributário da sua empresa.");
      return;
    }
    const rbtNum = lerNumeroBR(rbt12);
    if (regime === "SIMPLES_NACIONAL" && (!anexo || rbtNum == null)) {
      setErro("No Simples Nacional, informe o Anexo e o faturamento dos últimos 12 meses.");
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      const res = await fetch(`/api/editais/${pacote.edital.id}/estudo`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          regimeTributario: regime,
          anexoSimples: regime === "SIMPLES_NACIONAL" ? anexo || null : null,
          rbt12: regime === "SIMPLES_NACIONAL" ? rbtNum : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErro(data.error ?? "Não foi possível salvar o regime tributário.");
        return;
      }
      onPacote(data as PacoteAba);
      setAberto(false);
    } catch {
      setErro("Sem conexão. Tente de novo.");
    } finally {
      setSalvando(false);
    }
  }

  if (!aberto && aliquotas) {
    return (
      <Cartao className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="tipo-corpo-forte text-ink">
            Impostos: {aliquotas.aliquotaTotalEfetiva.toFixed(2).replace(".", ",")}% sobre a venda
          </p>
          <p className="tipo-pequeno text-ink-muted">
            {REGIME_LABEL[aliquotas.regime]}
            {aliquotas.anexoSimples ? ` · ${ANEXO_LABEL[aliquotas.anexoSimples]}` : ""}
            {aliquotas.rbt12 != null ? ` · faturamento 12 meses ${formatBRL(aliquotas.rbt12)}` : ""}
          </p>
        </div>
        <Button variant="secondary" size="compacto" onClick={() => setAberto(true)}>
          Alterar regime
        </Button>
      </Cartao>
    );
  }

  return (
    <Cartao className="space-y-4">
      <div>
        <p className="tipo-corpo-forte text-ink">Como a sua empresa paga imposto?</p>
        <p className="tipo-pequeno text-ink-muted">
          O imposto sai de cada venda, então entra na conta do preço. Se não souber, pergunte ao seu contador. Você pode deixar isto
          preenchido no cadastro da empresa para não precisar informar de novo.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Regime tributário" htmlFor="regime-aba">
          <Select id="regime-aba" value={regime} onChange={(e) => setRegime(e.target.value as RegimeTributario | "")}>
            <option value="">Selecione</option>
            {REGIMES_TRIBUTARIOS.map((r) => (
              <option key={r.key} value={r.key}>
                {r.label}
              </option>
            ))}
          </Select>
        </Field>

        {regime === "SIMPLES_NACIONAL" && (
          <>
            <Field label="Anexo do Simples" htmlFor="anexo-aba">
              <Select id="anexo-aba" value={anexo} onChange={(e) => setAnexo(e.target.value as AnexoSimples | "")}>
                <option value="">Selecione</option>
                {ANEXOS_SIMPLES.map((a) => (
                  <option key={a.key} value={a.key}>
                    {a.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Faturamento dos últimos 12 meses (R$)" htmlFor="rbt12-aba" hint="Também chamado de RBT12.">
              <TextInput id="rbt12-aba" inputMode="decimal" value={rbt12} onChange={(e) => setRbt12(e.target.value)} placeholder="0,00" />
            </Field>
          </>
        )}
      </div>

      {erro && (
        <p role="alert" className="tipo-pequeno text-danger-ink">
          {erro}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button onClick={confirmar} loading={salvando}>
          Confirmar regime
        </Button>
        {aliquotas && (
          <Button variant="ghost" onClick={() => setAberto(false)} disabled={salvando}>
            Cancelar
          </Button>
        )}
      </div>
    </Cartao>
  );
}
