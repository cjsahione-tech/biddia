// Limpeza final do texto do assistente Bidd.IA antes de mostrar na tela. A tela do chat exibe texto simples (não interpreta
// markdown), então títulos "##", negrito "**", linhas "---" e emojis apareceriam como símbolos soltos. O prompt já pede para
// não usá-los; isto é só a rede de segurança para quando o modelo escapar da regra.

const SIMBOLOS_DE_TEXTO = new Set(["©", "®", "™"]);

export function limparTextoAssistente(original: string): string {
  let t = original
    // emojis e símbolos decorativos (com o espaço que vem depois), mantendo © ® ™
    .replace(/[\p{Extended_Pictographic}️‍⃣]+ ?/gu, (m) => (SIMBOLOS_DE_TEXTO.has(m.trim()) ? m : ""))
    // linhas de separação: ---, ***, ___
    .replace(/^[ \t]*([-*_][ \t]*){3,}$/gm, "")
    // títulos: "## Resultados" → "Resultados"
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, "")
    // negrito: **texto** / __texto__ → texto
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/__([^_\n]+)__/g, "$1")
    // código em linha: `texto` → texto
    .replace(/`([^`\n]+)`/g, "$1")
    // marcador "* item" → "- item"
    .replace(/^([ \t]*)\*[ \t]+/gm, "$1- ")
    // espaços duplos que sobraram da limpeza e linhas em branco demais
    .replace(/(\S) {2,}/g, "$1 ")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // Se a limpeza esvaziou tudo (resposta feita só de símbolos), devolve o original em vez de uma bolha vazia.
  if (!t) t = original.trim();
  return t;
}
