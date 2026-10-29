import { describe, expect, it } from "vitest";
import { chaveDoAnexo, dividirEmAnexos, fidelidadeAoEdital, pareceModeloPreenchivel, sanearParagrafos } from "@/lib/agents/anexos-edital";

const EDITAL = `
EDITAL DE PREGÃO Nº 12/2026
Conforme o Anexo V deste edital, a proposta deve ser enviada pelo sistema.

ÍNDICE
ANEXO I – TERMO DE REFERÊNCIA
ANEXO II – MODELO DE DECLARAÇÃO DE INEXISTÊNCIA DE FATO IMPEDITIVO

ANEXO I – TERMO DE REFERÊNCIA
1. O objeto é a contratação de serviços de coleta.
1.1 Prazo de entrega: 10 dias.

ANEXO II – MODELO DE DECLARAÇÃO DE INEXISTÊNCIA DE FATO IMPEDITIVO
A empresa ______________, CNPJ n.º ____________, sediada em ____________, declara sob as penas da lei que inexiste fato impeditivo.
Local e data: ____________

ANEXO III
DECLARAÇÃO DE ELABORAÇÃO INDEPENDENTE DE PROPOSTA
Declaramos, para os devidos fins, que a proposta foi elaborada de maneira independente.

ANEXO IV – MODELO DE PROPOSTA COMERCIAL
Item | Descrição | Qtd | Valor
`;

describe("inventário de anexos do edital", () => {
  const anexos = dividirEmAnexos(EDITAL);

  it("acha todos os anexos pelo cabeçalho e ignora referência no meio de frase", () => {
    expect(anexos.map((a) => a.id)).toEqual(["I", "II", "III", "IV"]);
  });

  it("junta título na linha de baixo quando o cabeçalho é só 'ANEXO III'", () => {
    expect(anexos.find((a) => a.id === "III")?.titulo).toContain("ELABORAÇÃO INDEPENDENTE");
  });

  it("quando o anexo aparece no índice e no corpo, fica a versão completa", () => {
    const a2 = anexos.find((a) => a.id === "II")!;
    expect(a2.texto).toContain("sediada em");
  });

  it("reconhece o que é modelo de preencher e o que não é", () => {
    const ok = (id: string) => pareceModeloPreenchivel(anexos.find((a) => a.id === id)!);
    expect(ok("II")).toBe(true);
    expect(ok("III")).toBe(true);
    expect(ok("I")).toBe(false); // termo de referência
    expect(ok("IV")).toBe(false); // proposta comercial é do Financeiro
  });

  it("anexo sem título claro, mas com lacunas e linguagem de declaração, conta como modelo", () => {
    expect(
      pareceModeloPreenchivel({ titulo: "DOCUMENTO COMPLEMENTAR", texto: "A empresa ________, CNPJ ________, declara sob as penas da lei..." })
    ).toBe(true);
  });
});

describe("saneamento e fidelidade", () => {
  it("tira marcação de markdown sem mexer no conteúdo", () => {
    expect(sanearParagrafos(["**DECLARAÇÃO** de `teste`", "  ", "# Título", 5])).toEqual(["DECLARAÇÃO de teste", "Título"]);
  });

  it("compara nomes de anexo ignorando acento, caixa e o 'Anexo III –'", () => {
    expect(chaveDoAnexo("Anexo III – Declaração de Inexistência")).toBe(chaveDoAnexo("DECLARAÇÃO DE INEXISTÊNCIA"));
  });

  it("fidelidade alta quando o texto é do edital + dados da empresa; baixa quando foi reescrito", () => {
    const fonte = "A empresa declara sob as penas da lei que inexiste fato impeditivo para licitar.";
    const empresa = "Razão Social Exemplo Ltda CNPJ 12.345.678/0001-90";
    const fiel = fidelidadeAoEdital(["A empresa Razão Social Exemplo Ltda declara sob as penas da lei que inexiste fato impeditivo para licitar."], fonte, empresa);
    const inventado = fidelidadeAoEdital(["Reconhecemos solenemente nossa obrigação irrestrita perante qualquer tribunal competente."], fonte, empresa);
    expect(fiel).toBeGreaterThan(0.95);
    expect(inventado).toBeLessThan(0.3);
  });
});
