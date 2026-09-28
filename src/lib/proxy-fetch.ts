import { ProxyAgent } from "undici";

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
 * (hoje, só o PNCP); não trocar o fetch global do app inteiro por isso. */
export function fetchViaProxy(url: string, init: RequestInit & { signal?: AbortSignal }): Promise<Response> {
  const proxy = obterProxyDispatcher();
  if (!proxy) return fetch(url, init);
  return fetch(url, { ...init, dispatcher: proxy } as RequestInit);
}
