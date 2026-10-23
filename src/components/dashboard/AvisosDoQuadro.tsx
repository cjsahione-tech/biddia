import { AlertTriangle, Loader2 } from "lucide-react";

// Avisos que aparecem acima do quadro/lista de editais (limite do plano, andamento da busca, mensagens e erro de envio).
// Mesmas mensagens em qualquer tela; só o visual segue a identidade (faixas de status com ícone e palavra).
export type ProgressoBusca = { fase: string; novos: number; analisados: number } | null;
export type LimitePlano = { editaisAtivos: { atual: number; limite: number | null; excedido: boolean }; analisesNoMes: { atual: number; limite: number | null; excedido: boolean } } | null;

export type DadosAvisos = {
  limite: LimitePlano;
  buscando: boolean;
  progressoBusca: ProgressoBusca;
  mensagemBusca: string | null;
  erroEnvio: string | null;
};

export function AvisosDoQuadro({ limite, buscando, progressoBusca, mensagemBusca, erroEnvio }: DadosAvisos) {
  const algum = limite?.editaisAtivos.excedido || limite?.analisesNoMes.excedido || (buscando && progressoBusca) || mensagemBusca || erroEnvio;
  if (!algum) return null;
  return (
    <div className="mb-3 flex flex-col gap-2">
      {(limite?.editaisAtivos.excedido || limite?.analisesNoMes.excedido) && (
        <p className="flex items-start gap-2 rounded-tile bg-warning-bg px-4 py-3 text-sm text-warning-ink">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {limite.editaisAtivos.excedido &&
              `Você tem ${limite.editaisAtivos.atual} editais ativos, acima do limite de ${limite.editaisAtivos.limite} do seu plano. `}
            {limite.analisesNoMes.excedido &&
              `Já rodaram ${limite.analisesNoMes.atual} análises este mês, acima do limite de ${limite.analisesNoMes.limite} do seu plano. `}
            Nada foi bloqueado — considere um upgrade de plano pra continuar dentro do previsto.
          </span>
        </p>
      )}

      {buscando && progressoBusca && (
        <p className="flex items-center gap-2 rounded-tile bg-tint px-4 py-3 text-sm text-tint-ink">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
          <span>
            {progressoBusca.fase === "buscando" && "Buscando nos portais (PNCP, LicitaNet…) — você pode continuar usando o sistema, os cards aparecem sozinhos."}
            {progressoBusca.fase === "classificando" &&
              `${progressoBusca.analisados} oportunidade(s) encontrada(s) — avaliando quais combinam com a sua empresa…`}
            {progressoBusca.fase === "criando" &&
              `${progressoBusca.novos} edital(is) novo(s) já adicionado(s) ao quadro — finalizando a busca…`}
          </span>
        </p>
      )}

      {mensagemBusca && <p className="rounded-tile bg-surface px-4 py-3 text-sm text-ink shadow-card">{mensagemBusca}</p>}

      {erroEnvio && (
        <p className="flex items-start gap-2 rounded-tile bg-danger-bg px-4 py-3 text-sm text-danger-ink">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {erroEnvio}
        </p>
      )}
    </div>
  );
}
