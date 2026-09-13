import { describe, expect, it } from "vitest";
import { normalizarCargos, conferirEvidencias, numeroEhAutonomo } from "@/lib/agents/estudo-cargos";

describe("normalizarCargos", () => {
  it("descarta cargos sem nome (vazio ou só espaços)", () => {
    const resultado = normalizarCargos([
      { nome: "", quantidade: 2 },
      { nome: "   ", quantidade: 3 },
      { nome: "Vigilante", quantidade: 1 },
    ]);
    expect(resultado).toEqual([{ nome: "Vigilante", quantidade: 1 }]);
  });

  it("soma quantidades de cargos repetidos (mesmo nome, ignorando maiúsculas/minúsculas)", () => {
    const resultado = normalizarCargos([
      { nome: "Técnico de Laboratório", quantidade: 4 },
      { nome: "técnico de laboratório", quantidade: 2 },
    ]);
    expect(resultado).toEqual([{ nome: "Técnico de Laboratório", quantidade: 6 }]);
  });

  it("mantém a capitalização da primeira ocorrência ao deduplicar", () => {
    const resultado = normalizarCargos([
      { nome: "enfermeiro", quantidade: 1 },
      { nome: "Enfermeiro", quantidade: 1 },
    ]);
    expect(resultado[0].nome).toBe("enfermeiro");
    expect(resultado[0].quantidade).toBe(2);
  });

  it("normaliza quantidade inválida (zero, negativa, não numérica) para 1", () => {
    const resultado = normalizarCargos([
      { nome: "A", quantidade: 0 },
      { nome: "B", quantidade: -5 },
      { nome: "C", quantidade: NaN },
    ]);
    expect(resultado).toEqual([
      { nome: "A", quantidade: 1 },
      { nome: "B", quantidade: 1 },
      { nome: "C", quantidade: 1 },
    ]);
  });

  it("arredonda quantidades fracionárias", () => {
    const resultado = normalizarCargos([{ nome: "Motorista", quantidade: 2.6 }]);
    expect(resultado[0].quantidade).toBe(3);
  });

  it("limita a lista a 40 cargos mesmo que o modelo devolva mais", () => {
    const muitos = Array.from({ length: 60 }, (_, i) => ({ nome: `Cargo ${i}`, quantidade: 1 }));
    const resultado = normalizarCargos(muitos);
    expect(resultado).toHaveLength(40);
  });
});

describe("conferirEvidencias", () => {
  const textoFonte = `
    2.2.7 É de responsabilidade da CONTRATADA disponibilizar equipe mínima de 6 (seis)
    técnicos de laboratório e 2 (dois) enfermeiros para a execução dos serviços.
    O laboratório deverá processar cerca de 28.778 exames por mês.
  `;

  it("aceita quantidade > 1 quando a evidência citada realmente aparece no texto-fonte", () => {
    const resultado = conferirEvidencias(
      [{ nome: "Técnico de Laboratório", quantidade: 6, evidenciaQuantidade: "6 (seis) técnicos de laboratório" }],
      textoFonte
    );
    expect(resultado).toEqual([{ nome: "Técnico de Laboratório", quantidade: 6 }]);
  });

  it("reproduz o caso real observado: rejeita uma quantidade 'calculada' a partir do volume de exames, sem citação real", () => {
    // Cenário observado na prática: o modelo devolveu quantidade 10 para "Técnico de
    // Laboratório" citando o volume de exames/mês como evidência — não é uma citação de
    // uma quantidade de pessoal, então deve cair para 1.
    const resultado = conferirEvidencias(
      [{ nome: "Técnico de Laboratório", quantidade: 10, evidenciaQuantidade: "28.778 exames por mês" }],
      textoFonte
    );
    expect(resultado).toEqual([{ nome: "Técnico de Laboratório", quantidade: 1 }]);
  });

  it("rejeita quantidade > 1 sem nenhuma evidência informada", () => {
    const resultado = conferirEvidencias([{ nome: "Biomédico", quantidade: 4 }], textoFonte);
    expect(resultado).toEqual([{ nome: "Biomédico", quantidade: 1 }]);
  });

  it("rejeita quantidade > 1 quando a evidência é inventada (não existe no texto)", () => {
    const resultado = conferirEvidencias(
      [{ nome: "Vigilante", quantidade: 8, evidenciaQuantidade: "equipe mínima de 8 vigilantes por posto" }],
      textoFonte
    );
    expect(resultado).toEqual([{ nome: "Vigilante", quantidade: 1 }]);
  });

  it("não exige evidência quando a quantidade já é 1 (o padrão seguro)", () => {
    const resultado = conferirEvidencias([{ nome: "Auxiliar Administrativo", quantidade: 1 }], textoFonte);
    expect(resultado).toEqual([{ nome: "Auxiliar Administrativo", quantidade: 1 }]);
  });

  it("ignora diferenças de espaçamento/quebra de linha entre a citação e o texto-fonte", () => {
    const textoComQuebras = "equipe   mínima\nde 6 (seis)\n   técnicos de laboratório para o serviço";
    const resultado = conferirEvidencias(
      [{ nome: "Técnico de Laboratório", quantidade: 6, evidenciaQuantidade: "6 (seis) técnicos de laboratório" }],
      textoComQuebras
    );
    expect(resultado).toEqual([{ nome: "Técnico de Laboratório", quantidade: 6 }]);
  });
});

describe("numeroEhAutonomo", () => {
  it("aceita um número solto separado por espaços", () => {
    expect(numeroEhAutonomo("equipe mínima de 6 (seis) técnicos", 6)).toBe(true);
  });

  it("rejeita um número que faz parte de uma numeração de cláusula/item (ex: 11.1.34)", () => {
    expect(numeroEhAutonomo("11.1.34 Fornecer recursos humanos especializados", 11)).toBe(false);
  });

  it("rejeita um número que faz parte de um valor monetário (ex: R$ 5.000,00)", () => {
    expect(numeroEhAutonomo("no valor de R$ 5.000,00 mensais", 5)).toBe(false);
  });

  it("rejeita quando o número não aparece de forma alguma", () => {
    expect(numeroEhAutonomo("equipe mínima de técnicos qualificados", 6)).toBe(false);
  });
});

describe("conferirEvidencias — caso real: número de cláusula do edital confundido com quantidade", () => {
  it("rejeita quando a citação é tecnicamente real mas o número é de uma cláusula, não de pessoal", () => {
    const textoFonte = `
      11.1.34 Fornecer recursos humanos especializados e habilitados para a coleta e
      realização dos exames, pessoal técnico, operacional e administrativo, em número
      suficiente para desenvolver a todas as atividades previstas.
    `;
    const resultado = conferirEvidencias(
      [
        {
          nome: "Técnico de Laboratório",
          quantidade: 11,
          evidenciaQuantidade: "11.1.34 Fornecer recursos humanos especializados",
        },
      ],
      textoFonte
    );
    expect(resultado).toEqual([{ nome: "Técnico de Laboratório", quantidade: 1 }]);
  });

  it("rejeita uma citação real mas sem qualquer palavra relacionada a pessoal", () => {
    const textoFonte = "o contrato terá vigência de 12 meses, prorrogável nos termos da lei.";
    const resultado = conferirEvidencias(
      [{ nome: "Auxiliar", quantidade: 12, evidenciaQuantidade: "vigência de 12 meses" }],
      textoFonte
    );
    expect(resultado).toEqual([{ nome: "Auxiliar", quantidade: 1 }]);
  });
});
