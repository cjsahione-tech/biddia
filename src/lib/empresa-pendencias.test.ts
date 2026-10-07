import { describe, it, expect } from "vitest";
import { camposPendentes } from "@/lib/empresa-pendencias";

const completa = {
  objetoSocial: "Venda de materiais",
  logradouro: "Rua A",
  numero: "1",
  bairro: "Centro",
  cidade: "Campinas",
  uf: "SP",
  cep: "13000000",
  banco: "001",
  agencia: "0001",
  conta: "1-2",
  socioNome: "Fulano",
  socioCpf: "00000000000",
  logoUrl: "data:image/png;base64,xx",
  licitanetSegmentoId: null,
  totalKeywords: 2,
};

describe("camposPendentes", () => {
  it("empresa completa não tem pendência", () => {
    expect(camposPendentes(completa)).toEqual([]);
  });

  it("cliente criado só com o mínimo lista tudo que falta", () => {
    const p = camposPendentes({
      objetoSocial: "",
      logradouro: "",
      numero: "",
      bairro: "",
      cidade: "",
      uf: "",
      cep: "",
      banco: "",
      agencia: "",
      conta: "",
      socioNome: "",
      socioCpf: "",
      logoUrl: null,
      licitanetSegmentoId: null,
      totalKeywords: 0,
    });
    expect(p).toEqual([
      "Busca de editais (palavras-chave ou segmento do LicitaNet)",
      "Objeto social",
      "Endereço",
      "Dados bancários",
      "Responsável legal",
      "Logo",
    ]);
  });

  it("só o segmento do LicitaNet já basta para a busca", () => {
    expect(camposPendentes({ ...completa, totalKeywords: 0, licitanetSegmentoId: 90 })).toEqual([]);
  });

  it("endereço incompleto continua pendente", () => {
    expect(camposPendentes({ ...completa, cep: "  " })).toEqual(["Endereço"]);
  });
});
