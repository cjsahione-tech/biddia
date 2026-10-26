import { describe, expect, it } from "vitest";
import {
  acharLacunasDeNumeracao,
  blocosSuspeitos,
  compararComTotais,
  conferirLinhas,
  montarVeredito,
  paraNumero,
  pontuarDefeitos,
  totaisDeclaradosNoTexto,
  type ItemConferivel,
} from "@/lib/agents/financeiro-conferencia";

const item = (numero: number, quantidade: number, valorUnitario: number, extra: Partial<ItemConferivel> = {}): ItemConferivel => ({
  numero,
  descricao: `Item ${numero}`,
  quantidade,
  valorUnitario,
  valorTotalLinha: Number((quantidade * valorUnitario).toFixed(2)),
  ...extra,
});

describe("paraNumero", () => {
  it("entende número, decimal com ponto e formato brasileiro", () => {
    expect(paraNumero(12.5)).toBe(12.5);
    expect(paraNumero("1234.56")).toBe(1234.56);
    expect(paraNumero("1.234,56")).toBe(1234.56);
    expect(paraNumero("R$ 1.234,56")).toBe(1234.56);
    expect(paraNumero(null)).toBeNaN();
    expect(paraNumero("abc")).toBeNaN();
  });
});

describe("conferirLinhas — quantidade × unitário tem que dar o total impresso", () => {
  it("não acusa nada quando todas as linhas fecham", () => {
    expect(conferirLinhas([item(1, 10, 5), item(2, 3, 19.9)])).toEqual([]);
  });

  it("acusa a linha em que o unitário foi lido errado (casa decimal)", () => {
    const itens = [item(1, 10, 5), { ...item(2, 10, 5), valorUnitario: 50 }];
    const p = conferirLinhas(itens);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ indice: 1, tipo: "TOTAL_NAO_BATE", calculado: 500, impresso: 50 });
  });

  it("acusa quando a IA trocou unitário e total", () => {
    const p = conferirLinhas([{ ...item(1, 4, 25), valorUnitario: 100 }]);
    expect(p[0]?.tipo).toBe("TOTAL_NAO_BATE");
  });

  it("aceita a diferença de arredondamento do unitário em centavos", () => {
    // unitário impresso 3,33 mas o total real é 1000 × 3,3333 = 3333,30
    expect(conferirLinhas([{ numero: 1, descricao: "x", quantidade: 1000, valorUnitario: 3.33, valorTotalLinha: 3333.3 }])).toEqual([]);
  });

  it("não conta como erro quando a tabela não traz total por linha", () => {
    expect(conferirLinhas([{ numero: 1, descricao: "x", quantidade: 2, valorUnitario: 7, valorTotalLinha: null }])).toEqual([]);
  });

  it("acusa quantidade zerada ou inválida", () => {
    const p = conferirLinhas([{ numero: 1, descricao: "x", quantidade: 0, valorUnitario: 7 }]);
    expect(p[0]?.tipo).toBe("QUANTIDADE_INVALIDA");
  });
});

describe("acharLacunasDeNumeracao", () => {
  it("acha os itens que faltam na sequência e o trecho onde deviam estar", () => {
    const itens = [
      ...[1, 2, 3, 4, 5].map((n) => item(n, 1, 1, { bloco: 0 })),
      ...[8, 9, 10].map((n) => item(n, 1, 1, { bloco: 1 })),
    ];
    const l = acharLacunasDeNumeracao(itens);
    expect(l).toHaveLength(1);
    expect(l[0].faltando).toEqual([6, 7]);
    expect(l[0].blocos).toEqual([0, 1]);
  });

  it("inclui os trechos do meio quando o buraco atravessa vários", () => {
    const itens = [
      ...[1, 2, 3, 4].map((n) => item(n, 1, 1, { bloco: 0 })),
      ...[9, 10, 11].map((n) => item(n, 1, 1, { bloco: 3 })),
    ];
    expect(acharLacunasDeNumeracao(itens)[0].blocos).toEqual([0, 1, 2, 3]);
  });

  it("não acusa nada numa sequência completa", () => {
    expect(acharLacunasDeNumeracao([1, 2, 3, 4, 5, 6].map((n) => item(n, 1, 1)))).toEqual([]);
  });

  it("confere cada lote separado (lotes que recomeçam no 1)", () => {
    const itens = [
      ...[1, 2, 3, 4].map((n) => item(n, 1, 1, { lote: "1" })),
      ...[1, 2, 3, 4].map((n) => item(n, 1, 1, { lote: "2" })),
    ];
    expect(acharLacunasDeNumeracao(itens)).toEqual([]);
  });

  it("não conclui nada quando a numeração se repete no mesmo grupo", () => {
    const itens = [1, 2, 3, 1, 2, 3, 7].map((n) => item(n, 1, 1));
    expect(acharLacunasDeNumeracao(itens)).toEqual([]);
  });

  it("ignora numeração muito esburacada (provavelmente não é contínua)", () => {
    expect(acharLacunasDeNumeracao([1, 20, 40, 60, 80].map((n) => item(n, 1, 1)))).toEqual([]);
  });

  it("acusa o que falta no começo quando a sequência devia começar em 1", () => {
    const l = acharLacunasDeNumeracao([2, 3, 4, 5, 6].map((n) => item(n, 1, 1)));
    expect(l[0]?.faltando).toEqual([1]);
  });
});

describe("blocosSuspeitos e pontuarDefeitos", () => {
  it("junta os trechos das linhas que não fecham e dos buracos", () => {
    const itens = [
      item(1, 1, 1, { bloco: 0 }),
      { ...item(2, 10, 5, { bloco: 1 }), valorUnitario: 50 },
      item(3, 1, 1, { bloco: 2 }),
      item(4, 1, 1, { bloco: 2 }),
      item(7, 1, 1, { bloco: 3 }),
    ];
    const problemas = conferirLinhas(itens);
    const lacunas = acharLacunasDeNumeracao(itens);
    expect(blocosSuspeitos(itens, problemas, lacunas)).toEqual([1, 2, 3]);
  });

  it("a pontuação cai quando o defeito é corrigido", () => {
    const ruim = [item(1, 1, 1), { ...item(2, 10, 5), valorUnitario: 50 }, item(3, 1, 1), item(4, 1, 1)];
    const boa = [item(1, 1, 1), item(2, 10, 5), item(3, 1, 1), item(4, 1, 1)];
    expect(pontuarDefeitos(ruim)).toBe(1);
    expect(pontuarDefeitos(boa)).toBe(0);
  });
});

describe("totais declarados no texto", () => {
  it("acha os totais escritos no edital, sem inventar", () => {
    const texto = "Valor total estimado da contratação: R$ 1.234.567,89\nOutra linha\nTotal geral ..... R$ 500,00\nvalor unitário R$ 12,00";
    expect(totaisDeclaradosNoTexto(texto).sort((a, b) => a - b)).toEqual([500, 1234567.89]);
  });

  it("devolve vazio quando o texto não declara total", () => {
    expect(totaisDeclaradosNoTexto("Item 1 caneta R$ 2,00 R$ 20,00")).toEqual([]);
  });

  it("a soma bate com o total do edital (inteiro ou por lote)", () => {
    expect(compararComTotais(1000, [], [1000.02]).confere).toBe(true);
    expect(compararComTotais(1500, [600, 900], [900]).confere).toBe(true);
    expect(compararComTotais(1000, [], [], [1000]).confere).toBe(true); // total do PNCP
  });

  it("só acusa quando o MAIOR total do texto é maior que a soma (sinal de item faltando)", () => {
    expect(compararComTotais(1000, [], [2000])).toEqual({ confere: false, declaradoMaior: 2000 });
    // total menor que a soma pode ser de uma linha ou de um lote: não prova nada
    expect(compararComTotais(1000, [], [300, 40])).toEqual({ confere: false });
  });
});

describe("montarVeredito", () => {
  const sempreBate = { confere: true, valorQueBateu: 1 };

  it("CONFERIDA quando tudo que dava para conferir fechou", () => {
    const itens = [1, 2, 3, 4, 5].map((n) => item(n, 2, 10));
    expect(montarVeredito({ itens, totais: sempreBate }).status).toBe("CONFERIDA");
  });

  it("DIVERGENTE e explica quando uma linha não fecha", () => {
    const itens = [item(1, 1, 1), { ...item(2, 10, 5), valorUnitario: 50 }, item(3, 1, 1), item(4, 1, 1)];
    const v = montarVeredito({ itens, totais: sempreBate });
    expect(v.status).toBe("DIVERGENTE");
    expect(v.avisos[0]).toContain("imprime R$ 50.00");
  });

  it("DIVERGENTE quando o edital declara um total maior que a soma dos itens", () => {
    const itens = [1, 2, 3, 4].map((n) => item(n, 1, 10));
    const v = montarVeredito({ itens, totais: { confere: false, declaradoMaior: 500 } });
    expect(v.status).toBe("DIVERGENTE");
    expect(v.avisos.join(" ")).toContain("podem faltar itens");
  });

  it("PARCIAL quando nada está errado mas quase nada era conferível", () => {
    const itens = [1, 2, 3, 4].map((n) => ({ ...item(n, 1, 10), valorTotalLinha: null }));
    expect(montarVeredito({ itens, totais: { confere: false } }).status).toBe("PARCIAL");
  });
});
