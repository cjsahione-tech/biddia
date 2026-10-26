import { describe, expect, it } from "vitest";
import {
  acharLacunasDeNumeracao,
  blocosSuspeitos,
  conferirLinhas,
  paraNumero,
  pontuarDefeitos,
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
