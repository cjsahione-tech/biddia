import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import {
  conferirTotais,
  csvParaMatriz,
  decodificarTexto,
  descontoSobreReferencia,
  detectarMapeamento,
  lerPlanilhaDeMatriz,
  letraColuna,
  type Matriz,
} from "@/lib/planilha-resultado";
import { ErroLeituraPlanilha, lerArquivoPlanilha } from "@/lib/planilha-resultado-leitura";

const simples: Matriz = [
  ["Item", "Descrição", "Unidade", "Quantidade", "Valor unitário", "Valor total"],
  [1, "Caneta azul", "un", 100, 1.5, 150],
  [2, "Papel A4 resma", "cx", "10", "R$ 25,90", "R$ 259,00"],
  [null, null, null, null, null, null],
  [null, "TOTAL", null, null, null, 409],
];

describe("detectarMapeamento", () => {
  it("acha o cabeçalho e as colunas numa planilha simples", () => {
    const d = detectarMapeamento(simples);
    expect(d.linhaCabecalho).toBe(0);
    expect(d.mapeamento).toMatchObject({ numero: 0, descricao: 1, unidade: 2, quantidade: 3, valorUnitario: 4, valorTotal: 5 });
  });

  it("ignora linhas de título acima do cabeçalho e aceita variações de escrita", () => {
    const m: Matriz = [
      ["PREFEITURA MUNICIPAL DE EXEMPLO", null, null, null],
      ["Pregão 12/2026 - Proposta final", null, null, null],
      [null, null, null, null],
      ["Nº", "ESPECIFICAÇÃO DO PRODUTO", "QTD.", "Preço Unit. (R$)"],
      [1, "Luva de procedimento", 50, 32.1],
    ];
    const d = detectarMapeamento(m);
    expect(d.linhaCabecalho).toBe(3);
    expect(d.mapeamento).toMatchObject({ numero: 0, descricao: 1, quantidade: 2, valorUnitario: 3 });
  });

  it("entre vários valores unitários, prefere o da proposta e avisa", () => {
    const m: Matriz = [
      ["Item", "Descrição", "Qtde", "Valor unitário referência", "Valor unitário proposta final"],
      [1, "Cadeira", 10, 500, 430],
    ];
    const d = detectarMapeamento(m);
    expect(d.mapeamento.valorUnitario).toBe(4);
    expect(d.avisos[0]).toMatch(/proposta final/);
  });

  it("usa a coluna Item como descrição quando ela traz texto e não há coluna de descrição", () => {
    const m: Matriz = [
      ["Item", "Quantidade", "Valor unitário"],
      ["Mesa de reunião", 2, 900],
      ["Cadeira giratória", 8, 350],
    ];
    const d = detectarMapeamento(m);
    expect(d.mapeamento.descricao).toBe(0);
    expect(d.mapeamento.numero).toBeNull();
  });

  it("sem cabeçalho reconhecível devolve mapeamento vazio", () => {
    const d = detectarMapeamento([["a", "b"], [1, 2]]);
    expect(d.mapeamento).toEqual({});
  });
});

describe("lerPlanilhaDeMatriz", () => {
  it("lê os itens, converte números brasileiros e pula linhas de total", () => {
    const l = lerPlanilhaDeMatriz(simples);
    expect(l.faltando).toEqual([]);
    expect(l.itens).toHaveLength(2);
    expect(l.itens[1]).toMatchObject({ descricao: "Papel A4 resma", unidade: "cx", quantidade: 10, valorUnitario: 25.9, valorTotal: 259 });
    expect(l.itens[0].valorTotal).toBe(150);
  });

  it("recalcula o total por quantidade × valor unitário e avisa quando a planilha diverge", () => {
    const m: Matriz = [
      ["Descrição", "Quantidade", "Valor unitário", "Valor total"],
      ["Item A", 3, 10, 99],
    ];
    const l = lerPlanilhaDeMatriz(m);
    expect(l.itens[0].valorTotal).toBe(30);
    expect(l.avisos.join(" ")).toMatch(/total na planilha diferente/);
  });

  it("calcula o valor unitário a partir do total quando a coluna não existe", () => {
    const m: Matriz = [
      ["Descrição", "Quantidade", "Valor total"],
      ["Serviço de instalação", 4, 1000],
    ];
    const l = lerPlanilhaDeMatriz(m);
    expect(l.faltando).toEqual([]);
    expect(l.itens[0]).toMatchObject({ valorUnitario: 250, valorTotal: 1000 });
    expect(l.avisos.join(" ")).toMatch(/dividindo o total/);
  });

  it("ignora linhas inválidas com aviso e nunca inventa valor", () => {
    const m: Matriz = [
      ["Descrição", "Quantidade", "Valor unitário"],
      ["Item bom", 2, 5],
      ["Sem quantidade", null, 5],
      ["Quantidade zero", 0, 5],
      ["Sem preço", 3, null],
      [null, 1, 1],
    ];
    const l = lerPlanilhaDeMatriz(m);
    expect(l.itens.map((i) => i.descricao)).toEqual(["Item bom"]);
    expect(l.avisos.length).toBe(4);
  });

  it("aponta o que falta quando uma coluna obrigatória não foi achada", () => {
    const m: Matriz = [
      ["Produto", "Qtd"],
      ["Caneta", 10],
    ];
    const l = lerPlanilhaDeMatriz(m);
    expect(l.faltando).toEqual(["valorUnitario"]);
    expect(l.itens).toEqual([]);
  });

  it("aceita o ajuste do usuário por cima da detecção", () => {
    const m: Matriz = [
      ["Produto", "Qtd", "Coluna X"],
      ["Caneta", 10, 2.5],
    ];
    const l = lerPlanilhaDeMatriz(m, null, { valorUnitario: 2 });
    expect(l.faltando).toEqual([]);
    expect(l.itens[0]).toMatchObject({ quantidade: 10, valorUnitario: 2.5, valorTotal: 25 });
  });

  it("lista as colunas com o título ou a letra", () => {
    const l = lerPlanilhaDeMatriz([["Descrição", null, "Qtd", "Valor unitário"], ["A", null, 1, 1]]);
    expect(l.colunas.map((c) => c.titulo)).toEqual(["Descrição", "Coluna B", "Qtd", "Valor unitário"]);
  });
});

describe("CSV", () => {
  it("lê CSV com ponto e vírgula, aspas e vírgula decimal", () => {
    const texto = 'Item;Descrição;Quantidade;Valor unitário\r\n1;"Caneta; azul";100;"1,50"\r\n2;Papel;10;25,90\r\n';
    const l = lerPlanilhaDeMatriz(csvParaMatriz(texto));
    expect(l.itens).toHaveLength(2);
    expect(l.itens[0]).toMatchObject({ descricao: "Caneta; azul", quantidade: 100, valorUnitario: 1.5 });
    expect(l.itens[1].valorUnitario).toBe(25.9);
  });

  it("lê CSV separado por vírgula com valores em ponto decimal", () => {
    const l = lerPlanilhaDeMatriz(csvParaMatriz("Descricao,Qtd,Preco Unitario\nLuva,10,2.5\n"));
    expect(l.itens[0]).toMatchObject({ quantidade: 10, valorUnitario: 2.5, valorTotal: 25 });
  });

  it("relê em Windows-1252 quando o arquivo não é UTF-8", () => {
    const bytes = Uint8Array.from([0x44, 0x65, 0x73, 0x63, 0x72, 0x69, 0xe7, 0xe3, 0x6f]); // "Descrição" em latin1
    expect(decodificarTexto(bytes)).toBe("Descrição");
  });
});

describe("arquivo Excel de verdade", () => {
  async function gerarXlsx(montar: (wb: ExcelJS.Workbook) => void): Promise<Uint8Array> {
    const wb = new ExcelJS.Workbook();
    montar(wb);
    return new Uint8Array(await wb.xlsx.writeBuffer());
  }

  it("lê a aba certa mesmo quando a primeira aba é uma capa", async () => {
    const bytes = await gerarXlsx((wb) => {
      wb.addWorksheet("Capa").addRow(["Proposta da empresa X"]);
      const aba = wb.addWorksheet("Itens");
      aba.addRow(["Descrição", "Un.", "Qtde", "Valor unit."]);
      aba.addRow(["Detergente 5L", "un", 12, 18.9]);
      aba.addRow(["Desinfetante 2L", "un", 30, { formula: "5+3.5", result: 8.5 }]);
    });
    const l = await lerArquivoPlanilha(bytes, "proposta.xlsx");
    expect(l.nomeAba).toBe("Itens");
    expect(l.itens).toHaveLength(2);
    expect(l.itens[1]).toMatchObject({ valorUnitario: 8.5, valorTotal: 255 });
  });

  it("recusa Excel antigo (.xls) com mensagem clara", async () => {
    const antigo = Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]);
    await expect(lerArquivoPlanilha(antigo, "velho.xls")).rejects.toBeInstanceOf(ErroLeituraPlanilha);
  });

  it("lê CSV pelo mesmo caminho", async () => {
    const bytes = new TextEncoder().encode("Descrição;Quantidade;Valor unitário\nCaneta;5;2,00\n");
    const l = await lerArquivoPlanilha(bytes, "itens.csv");
    expect(l.itens[0]).toMatchObject({ quantidade: 5, valorUnitario: 2, valorTotal: 10 });
  });
});

describe("conferência com o valor homologado", () => {
  const itens = [{ valorTotal: 600 }, { valorTotal: 400 }];

  it("não diverge quando a soma bate", () => {
    expect(conferirTotais(1000, itens)).toMatchObject({ somaItens: 1000, divergente: false });
  });

  it("avisa quando passa de 1%", () => {
    const c = conferirTotais(900, itens);
    expect(c.divergente).toBe(true);
    expect(c.diferenca).toBe(100);
  });

  it("sem valor ou sem itens não conclui nada", () => {
    expect(conferirTotais(null, itens).divergente).toBe(false);
    expect(conferirTotais(1000, []).divergente).toBe(false);
  });

  it("calcula o desconto sobre a referência", () => {
    expect(descontoSobreReferencia(1000, 850)).toBeCloseTo(15);
    expect(descontoSobreReferencia(null, 850)).toBeNull();
    expect(descontoSobreReferencia(1000, null)).toBeNull();
  });
});

describe("letraColuna", () => {
  it("segue o padrão do Excel", () => {
    expect([0, 25, 26, 27, 51, 52].map(letraColuna)).toEqual(["A", "Z", "AA", "AB", "AZ", "BA"]);
  });
});
