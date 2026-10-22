import { describe, expect, it } from "vitest";
import { avaliarConfianca, lerMotivosDeRevisao, type LinhaParaConfianca } from "@/lib/habilitacao-confianca";

const linha = (categoria: string, situacao: LinhaParaConfianca["situacao"] = "ATENDIDA", certeza = true): LinhaParaConfianca => ({ categoria, situacao, certeza });
const nucleo = [linha("juridica"), linha("fiscal"), linha("trabalhista")];
const mais = (n: number, over: Partial<LinhaParaConfianca> = {}) => Array.from({ length: n }, () => ({ ...linha("economica"), ...over }));

describe("avaliarConfianca — quando o resultado precisa de revisão humana", () => {
  it("resultado sólido (10+ exigências, núcleo presente, poucas incertas): não pede revisão", () => {
    const r = avaliarConfianca({ linhas: [...nucleo, ...mais(8)], statusCalculado: "HABILITADA" });
    expect(r).toEqual({ revisar: false, motivos: [] });
  });

  it("'Não habilitada' nunca vira revisão (já é a resposta conservadora)", () => {
    expect(avaliarConfianca({ linhas: [linha("fiscal")], statusCalculado: "NAO_HABILITADA" }).revisar).toBe(false);
  });

  it("poucas exigências num resultado 'bom' (caso real: 4 exigências, 100%): revisar", () => {
    const r = avaliarConfianca({ linhas: [...nucleo, linha("fiscal")], statusCalculado: "HABILITADA_RESSALVAS" });
    expect(r.revisar).toBe(true);
    expect(r.motivos[0]).toMatch(/só 4 exigência/);
  });

  it("falta uma categoria do núcleo: revisar e diz qual", () => {
    const r = avaliarConfianca({ linhas: [linha("juridica"), linha("fiscal"), ...mais(10)], statusCalculado: "HABILITADA" });
    expect(r.revisar).toBe(true);
    expect(r.motivos.join(" ")).toMatch(/regularidade trabalhista/);
    expect(r.motivos.join(" ")).not.toMatch(/habilitação jurídica/);
  });

  it("metade ou mais das exigências com conferência incerta: revisar", () => {
    const linhas = [...nucleo, ...mais(7), ...mais(10, { situacao: "VERIFICAR", certeza: false })];
    const r = avaliarConfianca({ linhas, statusCalculado: "HABILITADA_RESSALVAS" });
    expect(r.revisar).toBe(true);
    expect(r.motivos.join(" ")).toMatch(/10 de 20/);
  });

  it("incertas abaixo do limite (como as ~30% das auditorias reais): não pede revisão por isso", () => {
    const linhas = [...nucleo, ...mais(11), ...mais(6, { situacao: "VERIFICAR", certeza: false })];
    expect(avaliarConfianca({ linhas, statusCalculado: "HABILITADA_RESSALVAS" }).revisar).toBe(false);
  });

  it("'não se aplica' não entra na conta de incertas, mas conta como categoria presente", () => {
    const linhas = [...nucleo, ...mais(8), ...mais(9, { situacao: "NAO_SE_APLICA", certeza: false })];
    expect(avaliarConfianca({ linhas, statusCalculado: "HABILITADA" }).revisar).toBe(false);
  });

  it("vários sinais juntos aparecem todos", () => {
    const r = avaliarConfianca({ linhas: [linha("economica")], statusCalculado: "HABILITADA" });
    expect(r.motivos.length).toBe(2);
  });
});

describe("lerMotivosDeRevisao", () => {
  it("lê o JSON gravado e ignora lixo", () => {
    expect(lerMotivosDeRevisao(JSON.stringify(["a", "b"]))).toEqual(["a", "b"]);
    expect(lerMotivosDeRevisao(null)).toEqual([]);
    expect(lerMotivosDeRevisao("{")).toEqual([]);
    expect(lerMotivosDeRevisao('{"a":1}')).toEqual([]);
    expect(lerMotivosDeRevisao('["a", 3]')).toEqual(["a"]);
  });
});

describe("avisos da leitura pedem revisão", () => {
  it("anexo em link externo ou contradição entre documentos: revisar, mesmo com o resto sólido", () => {
    const linhas = [...nucleo, ...mais(8)];
    const r = avaliarConfianca({ linhas, statusCalculado: "HABILITADA", avisos: ["O edital manda buscar anexo(s) em link externo (https://x.com/a.pdf)."] });
    expect(r.revisar).toBe(true);
    expect(r.motivos).toHaveLength(1);
  });
  it("'Não habilitada' continua sem revisão", () => {
    expect(avaliarConfianca({ linhas: [], statusCalculado: "NAO_HABILITADA", avisos: ["aviso"] }).revisar).toBe(false);
  });
});
