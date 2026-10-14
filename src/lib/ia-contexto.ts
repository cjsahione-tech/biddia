import { AsyncLocalStorage } from "node:async_hooks";

// Diz, para quem chama a IA lá no fundo (askJSON etc.), de QUAL agente e edital é a chamada — assim o
// consumo de tokens é registrado por agente sem precisar passar esse dado por todas as funções.
export type ContextoIA = { agente: string; editalId?: string };

const armazenamento = new AsyncLocalStorage<ContextoIA>();

export function comContextoIA<T>(contexto: ContextoIA, fn: () => Promise<T>): Promise<T> {
  return armazenamento.run(contexto, fn);
}

export function contextoIAAtual(): ContextoIA | undefined {
  return armazenamento.getStore();
}
