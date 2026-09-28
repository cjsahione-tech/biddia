import { ProxyAgent, fetch as undiciFetch } from "undici";

// O PNCP bloqueia toda a infraestrutura de saída da Vercel (confirmado: compute regional
// gru1 E a rede Edge global travam 100% das vezes; qualquer outro host .gov.br funciona
// normal na mesma função) — não tem workaround só de código, então as chamadas ao PNCP
// passam por um proxy residencial externo (Webshare ou equivalente), configurado via
// PROXY_HOST/PROXY_PORT/PROXY_USER/PROXY_PASS. Sem essas env vars (ex: rodando localmente
// em npm run dev, onde o IP de casa já funciona direto), cai pro fetch nativo sem proxy —
// nada quebra em dev.
let dispatcherCache: ProxyAgent | null | undefined;

function obterProxyDispatcher(): ProxyAgent | null {
  if (dispatcherCache !== undefined) return dispatcherCache;

  const { PROXY_HOST, PROXY_PORT, PROXY_USER, PROXY_PASS } = process.env;
  if (!PROXY_HOST || !PROXY_PORT) {
    dispatcherCache = null;
    return dispatcherCache;
  }

  const credenciais =
    PROXY_USER && PROXY_PASS ? `${encodeURIComponent(PROXY_USER)}:${encodeURIComponent(PROXY_PASS)}@` : "";
  dispatcherCache = new ProxyAgent(`http://${credenciais}${PROXY_HOST}:${PROXY_PORT}`);
  return dispatcherCache;
}

/** Mesma assinatura do fetch nativo — só acrescenta o dispatcher do proxy quando
 * configurado (ver comentário acima). Usar só onde o destino precisa mesmo do proxy
 * (hoje, só o PNCP); não trocar o fetch global do app inteiro por isso.
 *
 * Importante: quando há proxy, usa o fetch do PRÓPRIO pacote `undici` (não o fetch
 * nativo do Node) — o nativo embute sua própria cópia interna do undici, e passar um
 * dispatcher de uma versão diferente pro fetch nativo quebra com "invalid
 * onRequestStart method" (incompatibilidade entre as duas cópias). Usando o fetch do
 * mesmo pacote que criou o ProxyAgent, as versões sempre batem. */
export function fetchViaProxy(url: string, init: RequestInit & { signal?: AbortSignal }): Promise<Response> {
  const proxy = obterProxyDispatcher();
  if (!proxy) return fetch(url, init);
  return undiciFetch(url, { ...init, dispatcher: proxy } as Parameters<typeof undiciFetch>[1]) as unknown as Promise<Response>;
}
