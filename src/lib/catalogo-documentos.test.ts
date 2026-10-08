import { describe, it, expect } from "vitest";
import {
  CATALOGO_DOCUMENTOS,
  CATEGORIAS_CATALOGO,
  CHECKLIST_BASE_PARA_CATALOGO,
  chaveEfetivaDoDocumento,
  itemPorChave,
  itensDaCategoria,
} from "@/lib/catalogo-documentos";
import { CHECKLIST_BASE } from "@/lib/checklist-base";

describe("catálogo de documentos", () => {
  it("chaves únicas e toda categoria tem itens", () => {
    const chaves = CATALOGO_DOCUMENTOS.map((i) => i.chave);
    expect(new Set(chaves).size).toBe(chaves.length);
    for (const c of CATEGORIAS_CATALOGO) expect(itensDaCategoria(c.id).length).toBeGreaterThan(0);
  });

  it("tem os itens da lista pedida, por categoria", () => {
    const qtd = Object.fromEntries(CATEGORIAS_CATALOGO.map((c) => [c.id, itensDaCategoria(c.id).length]));
    expect(qtd).toEqual({
      juridica: 6,
      fiscal: 5,
      trabalhista: 5,
      economica: 6,
      tecnica_empresa: 6,
      equipe: 4,
      certificados: 7,
      atestados: 4,
    });
  });

  it("marca de aplicação [P]/[S]/[P+S] conforme a lista", () => {
    expect(itemPorChave("trabalhista-cndt")?.aplicacao).toBe("PS");
    expect(itemPorChave("fiscal-estadual-icms")?.aplicacao).toBe("P");
    expect(itemPorChave("fiscal-issqn")?.aplicacao).toBe("S");
    // Regularidade trabalhista inteira é [P+S]
    expect(itensDaCategoria("trabalhista").every((i) => i.aplicacao === "PS")).toBe(true);
  });

  it("notas informativas dos atestados existem e não são regras de bloqueio", () => {
    expect(itemPorChave("atestados-fornecimento")?.nota).toMatch(/50%/);
    expect(itemPorChave("atestados-tecnico-profissional")?.nota).toMatch(/quantitativos mínimos/);
  });

  it("todos os itens padrão do checklist apontam para itens que existem no catálogo", () => {
    for (const nome of CHECKLIST_BASE) {
      const chaves = CHECKLIST_BASE_PARA_CATALOGO[nome];
      expect(chaves?.length, nome).toBeGreaterThan(0);
      for (const c of chaves) expect(itemPorChave(c), c).toBeDefined();
    }
  });

  it("documentos antigos do dossiê continuam reconhecidos pelo nome do tipo", () => {
    for (const nome of CHECKLIST_BASE) {
      const chave = chaveEfetivaDoDocumento({ tipo: nome });
      expect(chave, nome).not.toBeNull();
      expect(CHECKLIST_BASE_PARA_CATALOGO[nome]).toContain(chave);
    }
    expect(chaveEfetivaDoDocumento({ tipo: "CERTIDÃO NEGATIVA DE DÉBITOS TRABALHISTAS" })).toBe("trabalhista-cndt");
    expect(chaveEfetivaDoDocumento({ tipo: "Certidão Negativa de Falência" })).toBe("economica-falencia");
  });

  it("tipo livre sem correspondência vai para Outros (chave nula) e a chave gravada vale mais", () => {
    expect(chaveEfetivaDoDocumento({ tipo: "PGRSS Laboratório" })).toBeNull();
    expect(chaveEfetivaDoDocumento({ tipo: "PGRSS Laboratório", catalogoChave: "certificados-iso" })).toBe("certificados-iso");
    expect(chaveEfetivaDoDocumento({ tipo: "x", catalogoChave: "chave-inexistente" })).toBeNull();
  });
});
