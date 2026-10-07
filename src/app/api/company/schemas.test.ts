import { describe, it, expect } from "vitest";
import { companySchema, companySchemaCliente } from "@/app/api/company/route";

const minimo = { razaoSocial: "Cliente Teste LTDA", cnpj: "11222333000181" };

describe("cadastro de empresa x cliente de Analista", () => {
  it("empresa comum continua exigindo os dados completos", () => {
    expect(companySchema.safeParse(minimo).success).toBe(false);
    expect(companySchema.safeParse({ ...minimo, banco: "", agencia: "", conta: "" }).success).toBe(false);
  });

  it("cliente de Analista aceita só razão social e CNPJ", () => {
    expect(companySchemaCliente.safeParse(minimo).success).toBe(true);
  });

  it("cliente aceita campos em branco, mas não valores inválidos", () => {
    expect(companySchemaCliente.safeParse({ ...minimo, banco: "", cep: "", uf: "", socioCpf: "" }).success).toBe(true);
    expect(companySchemaCliente.safeParse({ ...minimo, uf: "SPP" }).success).toBe(false);
    expect(companySchemaCliente.safeParse({ ...minimo, cep: "123" }).success).toBe(false);
    expect(companySchemaCliente.safeParse({ ...minimo, socioCpf: "123" }).success).toBe(false);
  });

  it("razão social e CNPJ continuam obrigatórios para o cliente", () => {
    expect(companySchemaCliente.safeParse({ razaoSocial: "", cnpj: "11222333000181" }).success).toBe(false);
    expect(companySchemaCliente.safeParse({ razaoSocial: "Cliente", cnpj: "123" }).success).toBe(false);
  });
});
