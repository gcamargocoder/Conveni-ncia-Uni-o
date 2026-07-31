import { describe, it, expect } from "vitest";
import { resumirPorFormaPagamento, VendaRelatorio } from "../relatorios.service";

const base = { id: "1", created_at: new Date().toISOString() };

describe("resumirPorFormaPagamento", () => {
  it("agrupa e soma corretamente por forma de pagamento", () => {
    const vendas: VendaRelatorio[] = [
      { ...base, total: 10, forma_pagamento: "pix", cancelada: false },
      { ...base, total: 20, forma_pagamento: "pix", cancelada: false },
      { ...base, total: 5, forma_pagamento: "dinheiro", cancelada: false },
    ];

    const resumo = resumirPorFormaPagamento(vendas);
    const pix = resumo.find((r) => r.forma_pagamento === "pix");
    expect(pix?.quantidade).toBe(2);
    expect(pix?.total).toBe(30);
  });

  it("ignora vendas canceladas no total", () => {
    const vendas: VendaRelatorio[] = [
      { ...base, total: 100, forma_pagamento: "pix", cancelada: true },
      { ...base, total: 10, forma_pagamento: "pix", cancelada: false },
    ];

    const resumo = resumirPorFormaPagamento(vendas);
    expect(resumo.find((r) => r.forma_pagamento === "pix")?.total).toBe(10);
  });
});
