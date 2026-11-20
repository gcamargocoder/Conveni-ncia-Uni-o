import { describe, expect, it } from "vitest";
import { JANELA_OFFLINE_MS, avaliarHorarioDaVenda, horarioDaVenda, lerInstante, ocorridoEmParaGravar } from "../horario";
import { vendaNaJanela } from "../filtro-horario";
import { avaliarVendaContraReferencia, type ReferenciaVenda, type VendaRecebida } from "../validacao-sincronizacao";

const AGORA = new Date("2026-11-20T15:00:00.000Z");
const antes = (ms: number) => new Date(AGORA.getTime() - ms).toISOString();
const depois = (ms: number) => new Date(AGORA.getTime() + ms).toISOString();
const H = 3600_000;
const MIN = 60_000;

describe("avaliarHorarioDaVenda", () => {
  it("a janela de sincronização é de 48 horas", () => {
    expect(JANELA_OFFLINE_MS).toBe(48 * H);
  });

  it("sem horário informado: nada a validar, ocorrido_em fica vazio (nunca vira 'agora')", () => {
    expect(avaliarHorarioDaVenda({ informado: undefined, agora: AGORA })).toEqual({ ocorrido_em: null, motivos: [] });
    expect(avaliarHorarioDaVenda({ informado: null, agora: AGORA })).toEqual({ ocorrido_em: null, motivos: [] });
  });

  it("venda online (agora) e offline dentro de 48 h são aceitas com o horário exato do aparelho", () => {
    for (const informado of [antes(2000), antes(3 * H), antes(47 * H + 59 * MIN)]) {
      const r = avaliarHorarioDaVenda({ informado, agora: AGORA });
      expect(r.motivos).toEqual([]);
      expect(r.ocorrido_em!.toISOString()).toBe(informado);
    }
  });

  it("mais de 48 h: fora da janela, não aceita o horário", () => {
    const r = avaliarHorarioDaVenda({ informado: antes(48 * H + MIN), agora: AGORA });
    expect(r.ocorrido_em).toBeNull();
    expect(r.motivos.map((m) => m.codigo)).toEqual(["fora_janela_offline"]);
    expect(r.motivos[0].mensagem).toMatch(/48 horas/);
  });

  it("relógio ADIANTADO: até 5 min de tolerância passa; além disso é recusado", () => {
    expect(avaliarHorarioDaVenda({ informado: depois(4 * MIN), agora: AGORA }).motivos).toEqual([]);
    const r = avaliarHorarioDaVenda({ informado: depois(6 * MIN), agora: AGORA });
    expect(r.ocorrido_em).toBeNull();
    expect(r.motivos.map((m) => m.codigo)).toEqual(["horario_futuro"]);
    expect(avaliarHorarioDaVenda({ informado: depois(3 * H), agora: AGORA }).motivos[0].codigo).toBe("horario_futuro");
  });

  it("relógio ATRASADO: pouco atrasado e depois da abertura do caixa passa; muito atrasado vai para revisão", () => {
    const caixa = new Date(AGORA.getTime() - 10 * H);
    expect(avaliarHorarioDaVenda({ informado: antes(30 * MIN), agora: AGORA, caixaAbertoEm: caixa }).motivos).toEqual([]);
    expect(avaliarHorarioDaVenda({ informado: antes(5 * 24 * H), agora: AGORA, caixaAbertoEm: caixa }).motivos.map((m) => m.codigo)).toContain("fora_janela_offline");
  });

  it("anterior à abertura do caixa vai para revisão (mesmo dentro de 48 h); igual à abertura passa", () => {
    const abertura = new Date(AGORA.getTime() - 2 * H);
    const r = avaliarHorarioDaVenda({ informado: antes(3 * H), agora: AGORA, caixaAbertoEm: abertura });
    expect(r.ocorrido_em).toBeNull();
    expect(r.motivos.map((m) => m.codigo)).toEqual(["anterior_abertura_caixa"]);
    expect(avaliarHorarioDaVenda({ informado: abertura.toISOString(), agora: AGORA, caixaAbertoEm: abertura }).motivos).toEqual([]);
  });

  it("antes da abertura E fora de 48 h: os dois motivos", () => {
    const abertura = new Date(AGORA.getTime() - 10 * H);
    const r = avaliarHorarioDaVenda({ informado: antes(60 * H), agora: AGORA, caixaAbertoEm: abertura });
    expect(r.motivos.map((m) => m.codigo).sort()).toEqual(["anterior_abertura_caixa", "fora_janela_offline"]);
  });

  it("valores sem sentido são recusados sem lançar", () => {
    for (const informado of ["", "ontem", "2026-13-45", 12345, {}, [], "x".repeat(100)]) {
      const r = avaliarHorarioDaVenda({ informado, agora: AGORA });
      expect(r.ocorrido_em).toBeNull();
      expect(r.motivos.map((m) => m.codigo)).toEqual(["horario_invalido"]);
    }
  });

  it("a mensagem é ESTÁVEL (não muda com o passar do tempo): a aprovação compara os motivos", () => {
    const informado = antes(60 * H);
    const a = avaliarHorarioDaVenda({ informado, agora: AGORA }).motivos[0].mensagem;
    const b = avaliarHorarioDaVenda({ informado, agora: new Date(AGORA.getTime() + 5 * H) }).motivos[0].mensagem;
    expect(a).toBe(b);
  });
});

describe("ocorridoEmParaGravar (última barreira do serviço)", () => {
  it("grava só data válida e dentro da tolerância; nunca troca por 'agora'", () => {
    expect(ocorridoEmParaGravar(antes(H), AGORA)!.toISOString()).toBe(antes(H));
    expect(ocorridoEmParaGravar(depois(3 * MIN), AGORA)!.toISOString()).toBe(depois(3 * MIN));
    expect(ocorridoEmParaGravar(depois(10 * MIN), AGORA)).toBeNull();
    expect(ocorridoEmParaGravar("lixo", AGORA)).toBeNull();
    expect(ocorridoEmParaGravar(undefined, AGORA)).toBeNull();
    expect(ocorridoEmParaGravar(new Date(AGORA.getTime() - H), AGORA)!.getTime()).toBe(AGORA.getTime() - H);
  });

  it("lerInstante recusa o que não é texto de data", () => {
    expect(lerInstante(1)).toBeNull();
    expect(lerInstante("2026-11-20T10:00:00-03:00")!.toISOString()).toBe("2026-11-20T13:00:00.000Z");
  });
});

describe("horarioDaVenda e filtro", () => {
  it("usa ocorrido_em quando existe; vendas antigas (sem ocorrido_em) usam created_at", () => {
    const criada = new Date("2026-11-20T15:00:00Z");
    expect(horarioDaVenda({ created_at: criada, ocorrido_em: new Date("2026-11-19T22:44:00Z") }).toISOString()).toBe("2026-11-19T22:44:00.000Z");
    expect(horarioDaVenda({ created_at: criada, ocorrido_em: null }).toISOString()).toBe(criada.toISOString());
    expect(horarioDaVenda({ created_at: "2026-03-10T10:00:00.000Z" }).toISOString()).toBe("2026-03-10T10:00:00.000Z");
  });

  it("o filtro cobre as duas colunas com a mesma janela (fim exclusivo, ou inclusivo quando pedido)", () => {
    const i = new Date("2026-11-20T03:00:00Z");
    const f = new Date("2026-11-21T03:00:00Z");
    expect(vendaNaJanela(i, f)).toEqual({ OR: [{ ocorrido_em: { gte: i, lt: f } }, { ocorrido_em: null, created_at: { gte: i, lt: f } }] });
    expect(vendaNaJanela(i, f, true)).toEqual({ OR: [{ ocorrido_em: { gte: i, lte: f } }, { ocorrido_em: null, created_at: { gte: i, lte: f } }] });
  });
});

describe("avaliarVendaContraReferencia — horário", () => {
  const F = "11111111-1111-4111-8111-111111111111";
  const P = "22222222-2222-4222-8222-222222222222";
  const CX = "33333333-3333-4333-8333-333333333333";
  const venda = (criado_em?: string): VendaRecebida => ({
    funcionario_id: F,
    forma_pagamento: "dinheiro",
    caixa_id: CX,
    dispositivo: "t1",
    criado_em,
    total: 10,
    itens: [{ produto_id: P, quantidade: 1, preco_unitario: 10 }],
  });
  const ref = (abertoEm: Date): ReferenciaVenda => ({
    agora: AGORA,
    caixa: { status: "aberto", terminal_id: "t1", aberto_em: abertoEm },
    funcionario: { ativo: true, deleted: false, cargo: "frentista" },
    produtos: new Map([[P, { preco_venda: 10, ativo: true, deleted: false }]]),
  });
  const abertura = new Date(AGORA.getTime() - 100 * H);

  it("venda no horário certo: nenhum motivo", () => {
    expect(avaliarVendaContraReferencia(venda(antes(5 * H)), ref(abertura))).toEqual([]);
  });

  it.each([
    ["fora de 48 h", antes(49 * H), "fora_janela_offline"],
    ["no futuro", depois(20 * MIN), "horario_futuro"],
    ["ilegível", "ontem", "horario_invalido"],
  ])("horário %s retém a venda (divergência aprovável), sem bloquear de vez", (_n, quando, codigo) => {
    const motivos = avaliarVendaContraReferencia(venda(quando), ref(abertura));
    expect(motivos.map((m) => m.codigo)).toContain(codigo);
    expect(motivos.every((m) => m.gravidade === "divergencia")).toBe(true);
  });

  it("anterior à abertura do caixa retém a venda", () => {
    const motivos = avaliarVendaContraReferencia(venda(antes(3 * H)), ref(new Date(AGORA.getTime() - 2 * H)));
    expect(motivos.map((m) => m.codigo)).toEqual(["anterior_abertura_caixa"]);
  });
});
