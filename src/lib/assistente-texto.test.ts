import { describe, expect, it } from "vitest";
import { limparTextoAssistente } from "@/lib/assistente-texto";

describe("limparTextoAssistente", () => {
  it("remove emojis (e o espaço depois deles) sem deixar espaço sobrando", () => {
    expect(limparTextoAssistente("✅ Ganhos: 1 edital\n❌ Perdidos: 0")).toBe("Ganhos: 1 edital\nPerdidos: 0");
    expect(limparTextoAssistente("Boa notícia — nenhum perdido 🎉")).toBe("Boa notícia — nenhum perdido");
    expect(limparTextoAssistente("🔥 Jaboatão: R$ 28,2 milhões")).toBe("Jaboatão: R$ 28,2 milhões");
  });

  it("remove títulos com # mantendo o texto", () => {
    expect(limparTextoAssistente("## Resultados\n### Números gerais:\nTotal: 64")).toBe("Resultados\nNúmeros gerais:\nTotal: 64");
  });

  it("remove linhas de separação ---, *** e ___", () => {
    expect(limparTextoAssistente("Primeiro parágrafo.\n\n---\n\nSegundo parágrafo.")).toBe("Primeiro parágrafo.\n\nSegundo parágrafo.");
    expect(limparTextoAssistente("A\n***\nB\n___\nC")).toBe("A\n\nB\n\nC");
  });

  it("remove negrito e código em linha, mantendo o conteúdo", () => {
    expect(limparTextoAssistente("O edital **Pregão nº 51/2026** vale `R$ 3.000.000,00`.")).toBe("O edital Pregão nº 51/2026 vale R$ 3.000.000,00.");
  });

  it("troca marcador de asterisco por hífen e preserva listas com hífen", () => {
    expect(limparTextoAssistente("* Crixás\n* Mococa\n- Itapoá")).toBe("- Crixás\n- Mococa\n- Itapoá");
  });

  it("não mexe em texto normal: números, R$, hífens no meio da frase, © ® ™ e datas", () => {
    const normal = "O Pregão Eletrônico nº 51/2026 (Ibiritê) foi homologado em R$ 3.000.000,00 — 12-03-2026. Marca X® e Y™ © 2026.";
    expect(limparTextoAssistente(normal)).toBe(normal);
  });

  it("não confunde multiplicação ou asterisco no meio da frase com marcação", () => {
    expect(limparTextoAssistente("Total = 3 * 4 itens")).toBe("Total = 3 * 4 itens");
  });

  it("limpa o exemplo real de resposta com cara de chatbot", () => {
    const resposta = [
      "Beleza! Agora ficou claro. Aqui vai o resumo:",
      "",
      "## 🎯 Resultados do Laboratório",
      "### Números gerais:",
      "- Total de editais: 64",
      "- ✅ Ganhos: 1 edital",
      "- ❌ Perdidos: 0",
      "",
      "---",
      "",
      "**Observação importante:** Boa notícia — nenhum perdido! 🎉",
    ].join("\n");
    const limpo = limparTextoAssistente(resposta);
    expect(limpo).not.toMatch(/[🎯✅❌🎉]/u);
    expect(limpo).not.toMatch(/#|\*\*|^---$/m);
    expect(limpo).toContain("- Ganhos: 1 edital");
    expect(limpo).toContain("Observação importante: Boa notícia — nenhum perdido!");
  });

  it("se a limpeza esvaziar tudo, devolve o original", () => {
    expect(limparTextoAssistente("🎉🎉")).toBe("🎉🎉");
  });

  it("mantém parágrafos separados por uma linha em branco", () => {
    expect(limparTextoAssistente("A.\n\n\n\nB.")).toBe("A.\n\nB.");
  });
});
