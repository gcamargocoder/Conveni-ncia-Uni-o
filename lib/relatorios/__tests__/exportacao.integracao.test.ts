// @vitest-environment node
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

/**
 * Exportação para Excel pela Server Action real, com sessão real, contra PostgreSQL de teste
 * (npm run test:integracao). Confere: exige login, respeita os filtros da tela, só entrega o fechamento de
 * turno ao administrador e os valores da planilha batem com o banco.
 */
process.env.TZ = "UTC";

const ambiente = vi.hoisted(() => ({ cookies: new Map<string, string>(), cabecalhos: new Map<string, string>() }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (nome: string) => (ambiente.cookies.has(nome) ? { name: nome, value: ambiente.cookies.get(nome)! } : undefined),
    set: (nome: string, valor: string) => {
      if (valor === "") ambiente.cookies.delete(nome);
      else ambiente.cookies.set(nome, valor);
    },
  }),
  headers: async () => ({ get: (nome: string) => ambiente.cabecalhos.get(nome.toLowerCase()) ?? null }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    throw new Error(`REDIRECT:${destino}`);
  },
}));

import { randomUUID } from "node:crypto";
import { prisma } from "@/services/prisma/client";
import { autenticar } from "@/services/auth/auth.service";
import { criarUsuarioDeTeste as criarUsuario } from "@/services/auth/__tests__/fixtures-usuarios";
import { COOKIE_SESSAO } from "@/lib/auth/constantes";
import { abrirCaixa, fecharCaixa } from "@/services/caixa.service";
import { listarCaixas } from "@/services/caixa-consulta.service";
import { registrarVenda } from "@/services/vendas.service";
import { instanteLocal } from "@/lib/utils/fuso";
import { exportarRelatorioVendasAction } from "../actions";
import { lerAba, lerZip } from "./ler-zip";

const SENHA = "Cafe-com-Leite-42";
const ids = { produto: "", ana: "", caixa: "" };

async function limparTudo() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "autorizacoes_caixa", "auditoria_caixa", "movimentos_caixa", "caixa_conflitos", "caixas", "vendas_revisao", "recebimentos", "contas_receber", "movimentacoes_estoque", "itens_venda", "vendas", "produtos", "categorias", "funcionarios", "clientes", "sessoes", "tokens_recuperacao", "limites_tentativa", "usuarios", "tentativas_pin" RESTART IDENTITY CASCADE'
  );
}

async function entrarComo(email: string) {
  const r = await autenticar({ email, senha: SENHA, ip: "10.0.0.1" });
  if (!r.ok) throw new Error("login de teste falhou");
  ambiente.cookies.set(COOKIE_SESSAO, r.token);
}

const em = (dia: string, hora: string) => instanteLocal(dia, hora).toISOString();

async function vender(hora: string, total: number, pagamentos?: { forma: "dinheiro" | "pix"; valor_centavos: number }[]) {
  await registrarVenda({
    id: randomUUID(),
    funcionario_id: ids.ana,
    forma_pagamento: pagamentos ? "misto" : "pix",
    dispositivo: "terminal-A",
    caixa_id: ids.caixa,
    itens: [{ produto_id: ids.produto, nome: "Água", quantidade: total / 10, preco_unitario: 10 }],
    pagamentos,
    ocorrido_em: em("2026-03-10", hora),
    origem: "online",
  });
}

const abas = (base64: string) => {
  const z = lerZip(Buffer.from(base64, "base64"));
  const nomes = [...z.get("xl/workbook.xml")!.toString().matchAll(/name="([^"]+)"/g)].map((m) => m[1]);
  return { z, nomes };
};

beforeEach(async () => {
  await limparTudo();
  ambiente.cookies.clear();
  ambiente.cabecalhos.clear();
  ambiente.cabecalhos.set("x-real-ip", "203.0.113.7");
  await criarUsuario({ nome: "Admin", email: "admin@loja.com", senha: SENHA, papel: "admin" });
  await criarUsuario({ nome: "Operador", email: "op@loja.com", senha: SENHA, papel: "operador" });
  const categoria = await prisma.categoria.create({ data: { nome: "Bebidas" } });
  ids.produto = (await prisma.produto.create({ data: { nome: "Água 500ml", categoria_id: categoria.id, preco_venda: 10, preco_custo: 4 } })).id;
  ids.ana = (await prisma.funcionario.create({ data: { nome: "Ana", cargo: "frentista", pin_hash: "x" } })).id;
  await prisma.movimentacaoEstoque.create({ data: { produto_id: ids.produto, tipo: "entrada", quantidade: 1000, funcionario_id: ids.ana } });
  ids.caixa = randomUUID();
  const aut = { funcionario_id: ids.ana, usuario_id: null, dispositivo: "terminal-A", origem: "online" as const };
  await abrirCaixa({ id: ids.caixa, terminal_id: "terminal-A", terminal_papel: "principal", fundo_inicial_centavos: 10000, aberto_em: em("2026-03-10", "07:00") }, aut);
  await vender("09:00", 30);
  await vender("10:00", 50, [{ forma: "dinheiro", valor_centavos: 2000 }, { forma: "pix", valor_centavos: 3000 }]);
  await vender("21:44:11", 25);
  const [c] = await listarCaixas({ ids: [ids.caixa] });
  await fecharCaixa({ caixa_id: ids.caixa, fechado_em: em("2026-03-10", "22:00"), conferencia: { dinheiro_centavos: c.resumo.dinheiro.saldo_esperado_centavos, pix_centavos: c.resumo.por_forma.pix.saldo_centavos } }, aut);
});

afterAll(async () => {
  await limparTudo();
  await prisma.$disconnect();
});

describe("exportarRelatorioVendasAction", () => {
  it("sem sessão não entrega nada", async () => {
    const r = await exportarRelatorioVendasAction({ de: "2026-03-10" });
    expect(r.sucesso).toBe(false);
  });

  it("administrador: planilha íntegra, com fechamento de turno, valores iguais aos do banco", async () => {
    await entrarComo("admin@loja.com");
    const r = await exportarRelatorioVendasAction({ de: "2026-03-10" });
    expect(r.sucesso).toBe(true);
    if (!r.sucesso) return;
    expect(r.nome).toBe("relatorio-vendas-2026-03-10.xlsx");
    const { z, nomes } = abas(r.base64);
    expect(nomes).toEqual(["Resumo", "Vendas", "Itens vendidos", "Pagamentos", "Fechamento de turno"]);

    const vendas = lerAba(z.get("xl/worksheets/sheet2.xml")!.toString());
    let soma = 0;
    const horarios: string[] = [];
    for (let linha = 2; vendas.has(`H${linha}`); linha++) {
      soma += Math.round(vendas.get(`H${linha}`)!.numero! * 100);
      horarios.push(`${vendas.get(`A${linha}`)!.texto} ${vendas.get(`B${linha}`)!.texto}`);
    }
    const [{ total }] = await prisma.$queryRaw<{ total: bigint }[]>`SELECT COALESCE(SUM(ROUND(total * 100)), 0)::bigint AS total FROM vendas WHERE cancelada = false`;
    expect(soma).toBe(Number(total));
    expect(soma).toBe(3000 + 5000 + 2500);
    expect(horarios.sort()).toEqual(["10/03/2026 09:00:00", "10/03/2026 10:00:00", "10/03/2026 21:44:11"]);

    const fech = lerAba(z.get("xl/worksheets/sheet5.xml")!.toString());
    expect(fech.get("G2")!.texto).toBe("Fechado");
    expect(fech.get("E2")!.texto).toBe("10/03/2026 22:00:00");
  });

  it("respeita os filtros da tela: 08:00–18:00 deixa de fora a venda das 21h44", async () => {
    await entrarComo("admin@loja.com");
    const r = await exportarRelatorioVendasAction({ de: "2026-03-10", ate: "2026-03-10", hi: "08:00", hf: "18:00" });
    if (!r.sucesso) throw new Error(r.erro);
    const vendas = lerAba(abas(r.base64).z.get("xl/worksheets/sheet2.xml")!.toString());
    const linhas = [...vendas.keys()].filter((k) => /^B\d+$/.test(k) && k !== "B1");
    expect(linhas.map((k) => vendas.get(k)!.texto).sort()).toEqual(["09:00:00", "10:00:00"]);
  });

  it("filtro de forma (Pix) mantém a venda dividida e some o que não tem Pix; pagamentos só da forma", async () => {
    await entrarComo("admin@loja.com");
    const r = await exportarRelatorioVendasAction({ de: "2026-03-10", forma: "pix" });
    if (!r.sucesso) throw new Error(r.erro);
    const { z } = abas(r.base64);
    const vendas = lerAba(z.get("xl/worksheets/sheet2.xml")!.toString());
    expect([...vendas.keys()].filter((k) => /^C\d+$/.test(k) && k !== "C1")).toHaveLength(3); // 30 (pix) + 50 (misto) + 25 (pix)
    const pags = lerAba(z.get("xl/worksheets/sheet4.xml")!.toString());
    const formas = [...pags.keys()].filter((k) => /^D\d+$/.test(k) && k !== "D1").map((k) => pags.get(k)!.texto);
    expect(new Set(formas)).toEqual(new Set(["Pix"]));
  });

  it("operador (não administrador) recebe as vendas, mas NÃO o fechamento de turno", async () => {
    await entrarComo("op@loja.com");
    const r = await exportarRelatorioVendasAction({ de: "2026-03-10" });
    if (!r.sucesso) throw new Error(r.erro);
    expect(abas(r.base64).nomes).toEqual(["Resumo", "Vendas", "Itens vendidos", "Pagamentos"]);
  });

  it("parâmetros hostis são ignorados sem quebrar nem vazar erro interno", async () => {
    await entrarComo("admin@loja.com");
    const r = await exportarRelatorioVendasAction({ de: "2026-03-10", funcionario: "x' OR 1=1 --", caixa: "../../etc", terminal: "a b;c" });
    expect(r.sucesso).toBe(true);
  });
});
