"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, Pencil, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { formatBRL } from "@/lib/format";
import { ROTULO_STATUS, STATUS_ASSINATURA, type StatusAssinatura } from "@/lib/admin-usuarios";

type Linha = {
  id: string;
  nome: string;
  email: string;
  tipoConta: "EMPRESA" | "ANALISTA";
  criadoEm: string;
  ehAdmin: boolean;
  empresa: { razaoSocial: string; cnpj: string; editais: number; documentos: number } | null;
  clienteDe: { nome: string; email: string; ativo: boolean } | null;
  clientesNaCarteira: number;
  plano: { id: string; nome: string; precoMensal: number } | null;
  status: StatusAssinatura;
  statusAtualizadoEm: string | null;
  emTesteAte: string | null;
  valorPersonalizado: number | null;
  valorMensal: number;
  receitaMes: number;
  custoMesBrl: number;
  lucroMes: number;
};

type Totais = {
  contas: number;
  ativas: number;
  emTeste: number;
  pendentes: number;
  canceladas: number;
  receitaMensal: number;
  aReceber: number;
  custoBrl: number;
  lucro: number;
};

type Plano = { id: string; nome: string; precoMensal: number; ativo: boolean };

const COR_STATUS: Record<StatusAssinatura, string> = {
  ATIVA: "border-success-ink/40 bg-success-bg text-success-ink",
  EM_TESTE: "border-brand/40 bg-brand-light text-brand",
  PAGAMENTO_PENDENTE: "border-warning-ink/40 bg-warning-bg text-warning-ink",
  CANCELADA: "border-border bg-muted/10 text-muted",
};

const selectClass = "rounded-lg border bg-background px-2 py-1.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-brand/20";

function dataBr(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString("pt-BR") : "—";
}

function CartaoResumo({ titulo, valor, detalhe, destaque }: { titulo: string; valor: string; detalhe?: string; destaque?: "bom" | "ruim" }) {
  return (
    <div className="rounded-card bg-surface shadow-card p-4">
      <p className="text-xs text-muted">{titulo}</p>
      <p className={`mt-1 text-xl font-semibold ${destaque === "ruim" ? "text-danger-ink" : destaque === "bom" ? "text-success-ink" : "text-foreground"}`}>{valor}</p>
      {detalhe && <p className="mt-0.5 text-xs text-muted">{detalhe}</p>}
    </div>
  );
}

export function AdminUsuariosClient() {
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [totais, setTotais] = useState<Totais | null>(null);
  const [planos, setPlanos] = useState<Plano[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<"TODOS" | StatusAssinatura>("TODOS");
  const [salvandoId, setSalvandoId] = useState<string | null>(null);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [valorCombinado, setValorCombinado] = useState("");
  const [fimTeste, setFimTeste] = useState("");
  const [excluindo, setExcluindo] = useState<Linha | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const [u, p] = await Promise.all([fetch("/api/admin/usuarios"), fetch("/api/admin/planos")]);
      if (!u.ok) throw new Error();
      const dados = await u.json();
      setLinhas(dados.usuarios);
      setTotais(dados.totais);
      if (p.ok) setPlanos(((await p.json()).planos as Plano[]).filter((x) => x.ativo));
      setErro(null);
    } catch {
      setErro("Não foi possível carregar os usuários.");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- busca inicial ao montar a tela
    carregar();
  }, [carregar]);

  async function salvar(id: string, corpo: object) {
    setSalvandoId(id);
    setAviso(null);
    try {
      const res = await fetch(`/api/admin/usuarios/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        setAviso(d?.error ?? "Não foi possível salvar.");
        return false;
      }
      await carregar();
      return true;
    } finally {
      setSalvandoId(null);
    }
  }

  function abrirEdicao(l: Linha) {
    setEditandoId(l.id);
    setValorCombinado(l.valorPersonalizado != null ? String(l.valorPersonalizado).replace(".", ",") : "");
    setFimTeste(l.emTesteAte ? l.emTesteAte.slice(0, 10) : "");
  }

  async function salvarEdicao(l: Linha) {
    const texto = valorCombinado.trim();
    const numero = texto === "" ? null : Number(texto.replace(/\./g, "").replace(",", "."));
    if (numero !== null && (!Number.isFinite(numero) || numero < 0)) {
      setAviso("Valor combinado inválido.");
      return;
    }
    const ok = await salvar(l.id, { valorMensalPersonalizado: numero, emTesteAte: fimTeste ? new Date(fimTeste).toISOString() : null });
    if (ok) setEditandoId(null);
  }

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return linhas.filter(
      (l) =>
        (filtroStatus === "TODOS" || l.status === filtroStatus) &&
        (!q || `${l.nome} ${l.email} ${l.empresa?.razaoSocial ?? ""} ${l.empresa?.cnpj ?? ""}`.toLowerCase().includes(q))
    );
  }, [linhas, busca, filtroStatus]);

  return (
    <div className="mx-auto w-full max-w-[var(--content-max)] px-[var(--gutter)] py-6 md:py-8">
      <h1 className="tipo-titulo-pagina text-ink">Usuários</h1>
      <p className="mt-1 text-sm text-muted">
        Todas as contas da plataforma, com plano, valor, custo de IA do mês e lucro. O status é mudado à mão (ainda não há cobrança automática) e{" "}
        <strong>não bloqueia o acesso</strong> da conta. O custo é só o gasto de IA atribuído à conta no mês, em reais estimados.
      </p>

      {totais && (
        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <CartaoResumo titulo="Contas" valor={String(totais.contas)} detalhe={`${totais.ativas} ativas · ${totais.emTeste} em teste · ${totais.pendentes} pendentes · ${totais.canceladas} canceladas`} />
          <CartaoResumo titulo="Receita do mês (ativas)" valor={formatBRL(totais.receitaMensal)} />
          <CartaoResumo titulo="A receber (pendentes)" valor={formatBRL(totais.aReceber)} />
          <CartaoResumo titulo="Custo de IA no mês" valor={formatBRL(totais.custoBrl)} />
          <CartaoResumo titulo="Lucro do mês" valor={formatBRL(totais.lucro)} destaque={totais.lucro < 0 ? "ruim" : "bom"} />
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome, e-mail, empresa ou CNPJ"
          className="w-full max-w-sm rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
        />
        <select value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value as typeof filtroStatus)} className="rounded-lg border border-border bg-background px-3 py-2 text-sm">
          <option value="TODOS">Todos os status</option>
          {STATUS_ASSINATURA.map((s) => (
            <option key={s} value={s}>
              {ROTULO_STATUS[s]}
            </option>
          ))}
        </select>
        <span className="text-xs text-muted">{visiveis.length} de {linhas.length}</span>
      </div>

      {erro && <p className="mt-4 text-sm text-danger-ink">{erro}</p>}
      {aviso && <p className="mt-4 text-sm text-warning-ink">{aviso}</p>}

      {carregando ? (
        <div className="flex justify-center py-20 text-muted">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-card bg-surface shadow-card">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="bg-surface/60 text-xs text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Usuário</th>
                <th className="px-3 py-2 font-medium">Plano</th>
                <th className="px-3 py-2 font-medium">Valor mensal</th>
                <th className="px-3 py-2 font-medium">Custo (mês)</th>
                <th className="px-3 py-2 font-medium">Lucro (mês)</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Desde</th>
                <th className="px-3 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {visiveis.map((l) => (
                <FragmentoLinha
                  key={l.id}
                  l={l}
                  planos={planos}
                  salvando={salvandoId === l.id}
                  editando={editandoId === l.id}
                  valorCombinado={valorCombinado}
                  fimTeste={fimTeste}
                  setValorCombinado={setValorCombinado}
                  setFimTeste={setFimTeste}
                  aoMudarStatus={(s) => salvar(l.id, { statusAssinatura: s })}
                  aoMudarPlano={(p) => salvar(l.id, { planId: p || null })}
                  aoEditar={() => (editandoId === l.id ? setEditandoId(null) : abrirEdicao(l))}
                  aoSalvarEdicao={() => salvarEdicao(l)}
                  aoExcluir={() => setExcluindo(l)}
                />
              ))}
              {visiveis.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-muted">
                    Nenhuma conta encontrada.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {excluindo && (
        <ModalExcluir
          alvo={excluindo}
          onFechar={() => setExcluindo(null)}
          onExcluido={async (mensagem) => {
            setExcluindo(null);
            setAviso(mensagem);
            await carregar();
          }}
        />
      )}
    </div>
  );
}

function FragmentoLinha(props: {
  l: Linha;
  planos: Plano[];
  salvando: boolean;
  editando: boolean;
  valorCombinado: string;
  fimTeste: string;
  setValorCombinado: (v: string) => void;
  setFimTeste: (v: string) => void;
  aoMudarStatus: (s: StatusAssinatura) => void;
  aoMudarPlano: (id: string) => void;
  aoEditar: () => void;
  aoSalvarEdicao: () => void;
  aoExcluir: () => void;
}) {
  const { l, planos } = props;
  const tipo = l.clienteDe ? `Cliente de ${l.clienteDe.nome}` : l.tipoConta === "ANALISTA" ? `Analista · ${l.clientesNaCarteira} cliente(s)` : "Empresa";
  return (
    <>
      <tr className="border-t border-border align-top">
        <td className="px-3 py-3">
          <p className="font-medium text-foreground">
            {l.nome}
            {l.ehAdmin && <span className="ml-2 rounded-full bg-brand-light px-2 py-0.5 text-[11px] font-semibold text-brand">admin</span>}
          </p>
          <p className="text-xs text-muted">{l.email}</p>
          <p className="text-xs text-muted">
            {tipo}
            {l.empresa ? ` · ${l.empresa.razaoSocial} · ${l.empresa.editais} edital(is)` : ""}
          </p>
        </td>
        <td className="px-3 py-3">
          <select
            value={l.plano?.id ?? ""}
            disabled={props.salvando}
            onChange={(e) => props.aoMudarPlano(e.target.value)}
            className={`${selectClass} max-w-[11rem] border-border`}
            aria-label={`Plano de ${l.nome}`}
          >
            <option value="">Sem plano</option>
            {planos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome} · {formatBRL(p.precoMensal)}
              </option>
            ))}
            {l.plano && !planos.some((p) => p.id === l.plano!.id) && <option value={l.plano.id}>{l.plano.nome} (inativo)</option>}
          </select>
        </td>
        <td className="px-3 py-3">
          <p className="font-medium text-foreground">{formatBRL(l.valorMensal)}</p>
          {l.valorPersonalizado != null && <p className="text-xs text-muted">valor combinado</p>}
        </td>
        <td className="px-3 py-3 text-foreground">{formatBRL(l.custoMesBrl)}</td>
        <td className={`px-3 py-3 font-medium ${l.lucroMes < 0 ? "text-danger-ink" : "text-foreground"}`} title={l.status === "ATIVA" ? undefined : "Só conta ativa gera receita; o custo de IA continua contando."}>
          {formatBRL(l.lucroMes)}
        </td>
        <td className="px-3 py-3">
          <select
            value={l.status}
            disabled={props.salvando}
            onChange={(e) => props.aoMudarStatus(e.target.value as StatusAssinatura)}
            className={`${selectClass} ${COR_STATUS[l.status]}`}
            aria-label={`Status de ${l.nome}`}
          >
            {STATUS_ASSINATURA.map((s) => (
              <option key={s} value={s}>
                {ROTULO_STATUS[s]}
              </option>
            ))}
          </select>
          {l.status === "EM_TESTE" && l.emTesteAte && <p className="mt-1 text-xs text-muted">teste até {dataBr(l.emTesteAte)}</p>}
        </td>
        <td className="px-3 py-3 text-xs text-muted">{dataBr(l.criadoEm)}</td>
        <td className="px-3 py-3">
          <div className="flex items-center gap-1">
            {props.salvando && <Loader2 className="h-4 w-4 animate-spin text-brand" />}
            <button onClick={props.aoEditar} className="rounded-md p-1.5 text-muted hover:bg-surface hover:text-brand" title="Valor combinado e fim do teste" aria-label={`Editar ${l.nome}`}>
              <Pencil className="h-4 w-4" />
            </button>
            {!l.ehAdmin && (
              <button onClick={props.aoExcluir} className="rounded-md p-1.5 text-muted hover:bg-surface hover:text-danger-ink" title="Excluir conta e todos os dados" aria-label={`Excluir ${l.nome}`}>
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        </td>
      </tr>
      {props.editando && (
        <tr className="border-t border-border bg-surface/40">
          <td colSpan={8} className="px-3 py-3">
            <div className="flex flex-wrap items-end gap-4">
              <label className="text-xs text-muted">
                Valor combinado (R$ por mês)
                <input
                  value={props.valorCombinado}
                  onChange={(e) => props.setValorCombinado(e.target.value)}
                  placeholder={l.plano ? `vazio = preço do plano (${formatBRL(l.plano.precoMensal)})` : "vazio = sem valor"}
                  className="mt-1 block w-64 rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
                />
              </label>
              <label className="text-xs text-muted">
                Fim do período de teste
                <input type="date" value={props.fimTeste} onChange={(e) => props.setFimTeste(e.target.value)} className="mt-1 block rounded-lg border border-border bg-background px-2 py-1.5 text-sm" />
              </label>
              <Button onClick={props.aoSalvarEdicao} loading={props.salvando}>
                Salvar
              </Button>
              <Button variant="secondary" onClick={props.aoEditar}>
                Cancelar
              </Button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function ModalExcluir({ alvo, onFechar, onExcluido }: { alvo: Linha; onFechar: () => void; onExcluido: (mensagem: string) => void | Promise<void> }) {
  const [digitado, setDigitado] = useState("");
  const [excluindo, setExcluindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const confere = digitado.trim().toLowerCase() === alvo.email.trim().toLowerCase();

  async function excluir() {
    setExcluindo(true);
    setErro(null);
    try {
      const res = await fetch(`/api/admin/usuarios/${alvo.id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmarEmail: digitado }) });
      const d = await res.json().catch(() => null);
      if (!res.ok) {
        setErro(d?.error ?? "Não foi possível excluir a conta.");
        return;
      }
      await onExcluido(
        `Conta de ${alvo.email} excluída: ${d.editaisApagados} edital(is) e ${d.arquivosApagados} arquivo(s) apagados.${d.aviso ? ` ${d.aviso}` : ""}`
      );
    } finally {
      setExcluindo(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-ink/40 md:items-center md:p-6" role="dialog" aria-modal="true" aria-label="Excluir conta">
      <div className="janela-painel flex max-h-[90dvh] w-full max-w-[560px] flex-col overflow-y-auto rounded-t-card bg-surface shadow-nav md:rounded-card p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 text-danger-ink">
            <AlertTriangle className="h-5 w-5" />
            <h2 className="text-lg font-semibold">Excluir conta e todos os dados</h2>
          </div>
          <button onClick={onFechar} className="text-muted hover:text-foreground" aria-label="Fechar">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-3 text-sm text-foreground">
          Você vai apagar <strong>{alvo.nome}</strong> ({alvo.email}). <strong>Não tem volta.</strong>
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
          <li>Login, empresa e cadastro{alvo.empresa ? ` (${alvo.empresa.razaoSocial})` : ""}.</li>
          <li>{alvo.empresa ? `${alvo.empresa.editais} edital(is) com análises, propostas, checklists, auditorias e documentos` : "Editais e documentos, se houver"}.</li>
          <li>{alvo.empresa ? `${alvo.empresa.documentos} documento(s) da base da empresa` : "Base de documentos, se houver"}, estudos de viabilidade e histórico de uso de IA.</li>
          <li>Todos os arquivos guardados no armazenamento.</li>
          {alvo.tipoConta === "ANALISTA" && alvo.clientesNaCarteira > 0 && (
            <li className="text-warning-ink">
              Os {alvo.clientesNaCarteira} cliente(s) da carteira <strong>não</strong> são apagados (têm login próprio); só deixam de estar ligados a este analista.
            </li>
          )}
        </ul>
        <label className="mt-4 block text-sm text-foreground">
          Para confirmar, digite o e-mail da conta: <span className="font-mono text-xs">{alvo.email}</span>
          <input
            value={digitado}
            onChange={(e) => setDigitado(e.target.value)}
            autoComplete="off"
            className="mt-1.5 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-danger-ink focus:outline-none focus:ring-2 focus:ring-danger-ink/20"
          />
        </label>
        {erro && <p className="mt-3 text-sm text-danger-ink">{erro}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={onFechar} disabled={excluindo}>
            Cancelar
          </Button>
          <Button variant="danger" onClick={excluir} loading={excluindo} disabled={!confere}>
            Excluir definitivamente
          </Button>
        </div>
      </div>
    </div>
  );
}
