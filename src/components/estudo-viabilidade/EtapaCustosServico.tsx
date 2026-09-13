"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, TextInput } from "@/components/ui/Field";
import { formatBRL } from "@/lib/format";
import { valorMensalUnitarioCargo, type CargoServico, type CustoOperacionalLinha } from "@/lib/estudo-custos";
import type { EstudoViabilidadeDetail } from "@/lib/types";

const CARGO_VAZIO: CargoServico = {
  nome: "",
  quantidade: 1,
  salarioBase: 0,
  percentualEncargos: 0,
  beneficiosValor: 0,
  origemEdital: false,
};

const CUSTO_OPERACIONAL_VAZIO: CustoOperacionalLinha = {
  nome: "",
  quantidade: null,
  valorUnitario: null,
  valorMensal: 0,
};

/** Etapa 4 (ramo Serviço): DRE mensal — cargos sugeridos por IA a partir do edital
 * (editáveis: origem edital ou não), custos operacionais nomeados livremente, desconto
 * ofertado sobre o teto e duração do contrato. */
export function EtapaCustosServico({
  estudo,
  onUpdated,
}: {
  estudo: EstudoViabilidadeDetail;
  onUpdated: (estudo: EstudoViabilidadeDetail) => void;
}) {
  const [editando, setEditando] = useState(false);
  const [loading, setLoading] = useState(true);
  const [extraindo, setExtraindo] = useState(false);
  const [valorTetoLote, setValorTetoLote] = useState(0);
  const [descontoPercentual, setDescontoPercentual] = useState("20");
  const [duracaoContratoMeses, setDuracaoContratoMeses] = useState("12");
  const [cargos, setCargos] = useState<CargoServico[]>([]);
  const [custosOperacionais, setCustosOperacionais] = useState<CustoOperacionalLinha[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState<"rascunho" | "confirmar" | null>(null);

  useEffect(() => {
    fetch(`/api/estudos/${estudo.id}/custos`)
      .then((r) => r.json())
      .then((data) => {
        if (data.valorTetoLote != null) setValorTetoLote(data.valorTetoLote);
        if (data.descontoPercentual != null) setDescontoPercentual(String(data.descontoPercentual));
        if (data.duracaoContratoMeses != null) setDuracaoContratoMeses(String(data.duracaoContratoMeses));
        if (data.cargos) setCargos(data.cargos);
        if (data.custosOperacionais) setCustosOperacionais(data.custosOperacionais);
      })
      .finally(() => setLoading(false));
  }, [estudo.id]);

  async function extrairNovamente() {
    setExtraindo(true);
    setErro(null);
    try {
      const res = await fetch(`/api/estudos/${estudo.id}/custos`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setErro(data.error ?? "Não foi possível extrair os cargos agora.");
        return;
      }
      setCargos(data.cargos);
    } finally {
      setExtraindo(false);
    }
  }

  function setCargo(i: number, patch: Partial<CargoServico>) {
    setCargos((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }

  function setCustoOperacional(i: number, patch: Partial<CustoOperacionalLinha>) {
    setCustosOperacionais((prev) =>
      prev.map((c, idx) => {
        if (idx !== i) return c;
        const atualizado = { ...c, ...patch };
        if (atualizado.quantidade != null && atualizado.valorUnitario != null) {
          atualizado.valorMensal = atualizado.quantidade * atualizado.valorUnitario;
        }
        return atualizado;
      })
    );
  }

  async function salvar(confirmar: boolean) {
    const desconto = Number(descontoPercentual);
    const duracao = Number(duracaoContratoMeses);
    if (Number.isNaN(desconto) || desconto < 0 || desconto >= 100) {
      setErro("Informe um desconto válido (0 a 99%).");
      return;
    }
    if (Number.isNaN(duracao) || duracao < 1) {
      setErro("Informe a duração do contrato em meses.");
      return;
    }
    if (confirmar && cargos.some((c) => !c.nome.trim())) {
      setErro("Todo cargo precisa ter um nome antes de confirmar.");
      return;
    }
    if (confirmar && custosOperacionais.some((c) => !c.nome.trim())) {
      setErro("Toda linha de custo operacional precisa ter um nome antes de confirmar.");
      return;
    }

    setSalvando(confirmar ? "confirmar" : "rascunho");
    setErro(null);
    try {
      const res = await fetch(`/api/estudos/${estudo.id}/custos`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          descontoPercentual: desconto,
          duracaoContratoMeses: duracao,
          cargos,
          custosOperacionais,
          confirmar,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErro(data.error ?? "Não foi possível salvar os custos.");
        return;
      }
      onUpdated({ ...estudo, custosConfirmadoEm: data.custosConfirmadoEm });
      if (confirmar) setEditando(false);
    } finally {
      setSalvando(null);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-10 text-muted">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (estudo.custosConfirmadoEm && !editando) {
    return (
      <ResumoCustosServico
        qtdCargos={cargos.length}
        qtdCustos={custosOperacionais.length}
        onEditar={() => setEditando(true)}
      />
    );
  }

  const inputClass =
    "w-full rounded-lg border border-border bg-background px-2 py-1.5 text-right text-xs text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border bg-surface/50 p-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted">Valor de referência do lote (teto)</p>
            <p className="mt-0.5 text-sm font-medium text-foreground">{formatBRL(valorTetoLote)}</p>
          </div>
          <Field label="% de desconto ofertado sobre o teto" htmlFor="desconto">
            <TextInput
              id="desconto"
              type="number"
              min={0}
              max={99}
              step={0.5}
              value={descontoPercentual}
              onChange={(e) => setDescontoPercentual(e.target.value)}
            />
          </Field>
          <Field label="Duração do contrato (meses)" htmlFor="duracao">
            <TextInput
              id="duracao"
              type="number"
              min={1}
              step={1}
              value={duracaoContratoMeses}
              onChange={(e) => setDuracaoContratoMeses(e.target.value)}
            />
          </Field>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-foreground">Cargos necessários (folha de pagamento)</h4>
          <button
            onClick={extrairNovamente}
            disabled={extraindo}
            className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline disabled:opacity-60"
          >
            {extraindo ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Extrair novamente do edital
          </button>
        </div>
        <p className="mt-1 text-xs text-muted">
          Sugeridos pela IA a partir do edital/termo de referência. Quando o edital não especifica a quantidade, a
          sugestão vem com 1 — ajuste conforme sua experiência. Adicione, edite ou remova livremente.
        </p>

        <div className="mt-3 overflow-x-auto rounded-2xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs font-medium uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2.5">Cargo</th>
                <th className="px-3 py-2.5 text-right">Qtd.</th>
                <th className="px-3 py-2.5 text-right">Salário-base (R$)</th>
                <th className="px-3 py-2.5 text-right">Encargos (%)</th>
                <th className="px-3 py-2.5 text-right">Benefícios (R$)</th>
                <th className="px-3 py-2.5 text-right">Valor mensal</th>
                <th className="px-2 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {cargos.map((cargo, i) => (
                <tr key={i}>
                  <td className="px-3 py-2">
                    <input
                      value={cargo.nome}
                      onChange={(e) => setCargo(i, { nome: e.target.value })}
                      placeholder="Nome do cargo"
                      className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                    />
                    {cargo.origemEdital && <span className="mt-1 block text-[10px] text-muted">Sugerido do edital</span>}
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={cargo.quantidade}
                      onChange={(e) => setCargo(i, { quantidade: Number(e.target.value) })}
                      className={inputClass}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={cargo.salarioBase}
                      onChange={(e) => setCargo(i, { salarioBase: Number(e.target.value) })}
                      className={inputClass}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min={0}
                      step={0.1}
                      value={cargo.percentualEncargos}
                      onChange={(e) => setCargo(i, { percentualEncargos: Number(e.target.value) })}
                      className={inputClass}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={cargo.beneficiosValor}
                      onChange={(e) => setCargo(i, { beneficiosValor: Number(e.target.value) })}
                      className={inputClass}
                    />
                  </td>
                  <td className="px-3 py-2 text-right text-xs text-foreground">
                    {formatBRL(cargo.quantidade * valorMensalUnitarioCargo(cargo))}
                  </td>
                  <td className="px-2 py-2 text-center">
                    <button
                      onClick={() => setCargos((prev) => prev.filter((_, idx) => idx !== i))}
                      className="text-muted hover:text-danger"
                      title="Remover cargo"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
              {cargos.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-xs text-muted">
                    Nenhum cargo ainda — adicione manualmente ou extraia do edital.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <button
          onClick={() => setCargos((prev) => [...prev, { ...CARGO_VAZIO }])}
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"
        >
          <Plus className="h-3.5 w-3.5" /> Adicionar cargo
        </button>
      </div>

      <div>
        <h4 className="text-sm font-semibold text-foreground">Custos operacionais diretos</h4>
        <p className="mt-1 text-xs text-muted">
          Aluguel, insumos, equipamentos, utilidades etc. Informe quantidade + valor unitário quando fizer sentido
          (ex: insumos por exame), ou digite o valor mensal direto.
        </p>

        <div className="mt-3 overflow-x-auto rounded-2xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs font-medium uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2.5">Descrição</th>
                <th className="px-3 py-2.5 text-right">Qtd./Ref.</th>
                <th className="px-3 py-2.5 text-right">Valor unit. (R$)</th>
                <th className="px-3 py-2.5 text-right">Valor mensal (R$)</th>
                <th className="px-2 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {custosOperacionais.map((linha, i) => (
                <tr key={i}>
                  <td className="px-3 py-2">
                    <input
                      value={linha.nome}
                      onChange={(e) => setCustoOperacional(i, { nome: e.target.value })}
                      placeholder="Descrição do custo"
                      className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      step={0.01}
                      value={linha.quantidade ?? ""}
                      onChange={(e) =>
                        setCustoOperacional(i, { quantidade: e.target.value === "" ? null : Number(e.target.value) })
                      }
                      className={inputClass}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      step={0.01}
                      value={linha.valorUnitario ?? ""}
                      onChange={(e) =>
                        setCustoOperacional(i, { valorUnitario: e.target.value === "" ? null : Number(e.target.value) })
                      }
                      className={inputClass}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      step={0.01}
                      value={linha.valorMensal}
                      disabled={linha.quantidade != null && linha.valorUnitario != null}
                      onChange={(e) => setCustoOperacional(i, { valorMensal: Number(e.target.value) })}
                      className={`${inputClass} disabled:opacity-60`}
                    />
                  </td>
                  <td className="px-2 py-2 text-center">
                    <button
                      onClick={() => setCustosOperacionais((prev) => prev.filter((_, idx) => idx !== i))}
                      className="text-muted hover:text-danger"
                      title="Remover linha"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
              {custosOperacionais.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-xs text-muted">
                    Nenhum custo operacional ainda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <button
          onClick={() => setCustosOperacionais((prev) => [...prev, { ...CUSTO_OPERACIONAL_VAZIO }])}
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"
        >
          <Plus className="h-3.5 w-3.5" /> Adicionar linha
        </button>
      </div>

      {erro && <p className="text-xs text-danger">{erro}</p>}

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={() => salvar(false)} loading={salvando === "rascunho"}>
          Salvar rascunho
        </Button>
        <Button onClick={() => salvar(true)} loading={salvando === "confirmar"}>
          Confirmar e continuar
        </Button>
      </div>
    </div>
  );
}

function ResumoCustosServico({
  qtdCargos,
  qtdCustos,
  onEditar,
}: {
  qtdCargos: number;
  qtdCustos: number;
  onEditar: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 rounded-xl bg-accent/10 px-4 py-2.5 text-sm text-accent">
        <span className="inline-flex items-center gap-1.5 font-medium">
          <CheckCircle2 className="h-4 w-4" /> Custos confirmados
        </span>
        <button onClick={onEditar} className="inline-flex items-center gap-1 text-xs font-medium hover:underline">
          <Pencil className="h-3 w-3" /> Editar novamente
        </button>
      </div>

      <div className="rounded-2xl border border-border bg-surface/50 p-5">
        <p className="text-sm text-foreground">
          {qtdCargos} cargo(s) e {qtdCustos} linha(s) de custo operacional informados.
        </p>
      </div>
    </div>
  );
}
