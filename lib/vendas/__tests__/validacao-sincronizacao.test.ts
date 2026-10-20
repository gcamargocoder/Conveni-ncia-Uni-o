import { describe, it, expect } from "vitest";
import {
  avaliarVendaContraReferencia,
  paraCentavos,
  paraMilesimos,
  possuiMotivoBloqueante,
  totalEmCentavos,
  validarEstruturaVenda,
  type ReferenciaVenda,
  type VendaRecebida,
} from "../validacao-sincronizacao";

const ID = "11111111-1111-4111-8111-111111111111";
const FUNC = "22222222-2222-4222-8222-222222222222";
const PROD = "33333333-3333-4333-8333-333333333333";
const CLI = "44444444-4444-4444-8444-444444444444";

function venda(sobrescrever: Partial<VendaRecebida> = {}): VendaRecebida {
  return {
    funcionario_id: FUNC,
    forma_pagamento: "pix",
    itens: [{ produto_id: PROD, quantidade: 2, preco_unitario: 3.5 }],
    ...sobrescrever,
  };
}

function referencia(sobrescrever: Partial<ReferenciaVenda> = {}): ReferenciaVenda {
  return {
    funcionario: { ativo: true, deleted: false, cargo: "caixa" },
    produtos: new Map([[PROD, { preco_venda: 3.5, ativo: true, deleted: false }]]),
    ...sobrescrever,
  };
}

const codigos = (m: { codigo: string }[]) => m.map((x) => x.codigo);

describe("validarEstruturaVenda", () => {
  it("aceita uma venda bem formada", () => {
    expect(validarEstruturaVenda(ID, venda())).toEqual([]);
  });

  it.each([0, -1, NaN, Infinity, "2", null, undefined, 1.0001, 1e12])("quantidade inválida (%s) é bloqueante", (q) => {
    const motivos = validarEstruturaVenda(ID, venda({ itens: [{ produto_id: PROD, quantidade: q as number, preco_unitario: 1 }] }));
    expect(codigos(motivos)).toContain("quantidade_invalida");
    expect(possuiMotivoBloqueante(motivos)).toBe(true);
  });

  it("aceita quantidade fracionada com até 3 casas (produto a granel)", () => {
    expect(validarEstruturaVenda(ID, venda({ itens: [{ produto_id: PROD, quantidade: 0.325, preco_unitario: 10 }] }))).toEqual([]);
  });

  it.each([-1, NaN, Infinity, "3", 1.234, 1e10])("preço inválido (%s) é bloqueante", (preco) => {
    const motivos = validarEstruturaVenda(ID, venda({ itens: [{ produto_id: PROD, quantidade: 1, preco_unitario: preco as number }] }));
    expect(codigos(motivos)).toContain("preco_invalido");
  });

  it("rejeita ids que não são UUID (venda, funcionário, produto, cliente)", () => {
    expect(codigos(validarEstruturaVenda("abc", venda()))).toContain("id_invalido");
    expect(codigos(validarEstruturaVenda(ID, venda({ funcionario_id: "x" })))).toContain("funcionario_invalido");
    expect(codigos(validarEstruturaVenda(ID, venda({ itens: [{ produto_id: "x", quantidade: 1, preco_unitario: 1 }] })))).toContain("produto_invalido");
    expect(codigos(validarEstruturaVenda(ID, venda({ cliente_id: "x" })))).toContain("cliente_invalido");
  });

  it("rejeita forma de pagamento desconhecida, venda sem itens, e fiado sem cliente", () => {
    expect(codigos(validarEstruturaVenda(ID, venda({ forma_pagamento: "cheque" as never })))).toContain("pagamento_invalido");
    expect(codigos(validarEstruturaVenda(ID, venda({ itens: [] })))).toContain("sem_itens");
    expect(codigos(validarEstruturaVenda(ID, venda({ forma_pagamento: "fiado" })))).toContain("fiado_sem_cliente");
    expect(validarEstruturaVenda(ID, venda({ forma_pagamento: "fiado", cliente_id: CLI }))).toEqual([]);
  });

  it("rejeita payload que não é objeto", () => {
    for (const p of [null, undefined, "x", 5]) {
      expect(possuiMotivoBloqueante(validarEstruturaVenda(ID, p))).toBe(true);
    }
  });

  it("limita a quantidade de itens", () => {
    const itens = Array.from({ length: 501 }, () => ({ produto_id: PROD, quantidade: 1, preco_unitario: 1 }));
    expect(codigos(validarEstruturaVenda(ID, venda({ itens })))).toContain("itens_demais");
  });
});

describe("avaliarVendaContraReferencia", () => {
  it("venda correta (preço igual ao cadastro, funcionário ativo que vende) não gera motivos", () => {
    expect(avaliarVendaContraReferencia(venda({ total: 7 }), referencia())).toEqual([]);
  });

  it("preço adulterado vira divergência (retida), não é aceito", () => {
    const m = avaliarVendaContraReferencia(venda({ itens: [{ produto_id: PROD, quantidade: 2, preco_unitario: 0.01 }] }), referencia());
    expect(codigos(m)).toContain("preco_divergente");
    expect(possuiMotivoBloqueante(m)).toBe(false);
  });

  it("diferença de 1 centavo também é detectada", () => {
    const m = avaliarVendaContraReferencia(venda({ itens: [{ produto_id: PROD, quantidade: 1, preco_unitario: 3.49 }] }), referencia());
    expect(codigos(m)).toContain("preco_divergente");
  });

  it("total informado incoerente com os itens é detectado", () => {
    expect(codigos(avaliarVendaContraReferencia(venda({ total: 1 }), referencia()))).toContain("total_incoerente");
  });

  it("funcionário inexistente é bloqueante; inativo ou removido é divergência", () => {
    expect(codigos(avaliarVendaContraReferencia(venda(), referencia({ funcionario: null })))).toContain("funcionario_inexistente");
    expect(possuiMotivoBloqueante(avaliarVendaContraReferencia(venda(), referencia({ funcionario: null })))).toBe(true);

    const inativo = avaliarVendaContraReferencia(venda(), referencia({ funcionario: { ativo: false, deleted: false, cargo: "caixa" } }));
    expect(codigos(inativo)).toContain("funcionario_inativo");
    expect(possuiMotivoBloqueante(inativo)).toBe(false);

    expect(codigos(avaliarVendaContraReferencia(venda(), referencia({ funcionario: { ativo: true, deleted: true, cargo: "caixa" } })))).toContain("funcionario_inativo");
  });

  it("funcionário cujo cargo não vende (estoquista) é divergência", () => {
    const m = avaliarVendaContraReferencia(venda(), referencia({ funcionario: { ativo: true, deleted: false, cargo: "estoquista" } }));
    expect(codigos(m)).toContain("funcionario_sem_permissao");
  });

  it("produto inexistente é bloqueante; inativo é divergência", () => {
    expect(possuiMotivoBloqueante(avaliarVendaContraReferencia(venda(), referencia({ produtos: new Map() })))).toBe(true);
    const inativo = avaliarVendaContraReferencia(
      venda(),
      referencia({ produtos: new Map([[PROD, { preco_venda: 3.5, ativo: false, deleted: false }]]) })
    );
    expect(codigos(inativo)).toContain("produto_inativo");
  });

  it("cliente inexistente é bloqueante; inativo é divergência", () => {
    const v = venda({ forma_pagamento: "fiado", cliente_id: CLI });
    expect(possuiMotivoBloqueante(avaliarVendaContraReferencia(v, referencia({ cliente: null })))).toBe(true);
    expect(codigos(avaliarVendaContraReferencia(v, referencia({ cliente: { ativo: false, deleted: false } })))).toContain("cliente_inativo");
  });
});

describe("aritmética em centavos", () => {
  it("tolera o ruído de ponto flutuante, mas recusa mais de 2 casas", () => {
    expect(paraCentavos(0.1 + 0.2)).toBe(30);
    expect(paraCentavos(0.005)).toBe(null);
  });

  it("converte valores monetários e quantidades válidos", () => {
    expect(paraCentavos(19.9)).toBe(1990);
    expect(paraCentavos(0.07)).toBe(7);
    expect(paraMilesimos(0.325)).toBe(325);
    expect(totalEmCentavos([{ produto_id: PROD, quantidade: 3, preco_unitario: 0.1 }])).toBe(30);
    expect(totalEmCentavos([{ produto_id: PROD, quantidade: 0.325, preco_unitario: 10 }])).toBe(325);
  });
});
