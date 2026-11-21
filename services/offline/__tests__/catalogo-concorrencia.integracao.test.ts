// @vitest-environment node
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

/**
 * Concorrência entre ABAS sem Web Locks (Node não tem `navigator.locks`, como numa página HTTP da rede local) e
 * transações demoradas no PostgreSQL. Cada "aba" é uma instância separada dos módulos do aparelho (vi.resetModules),
 * com a sua própria conexão Dexie ao MESMO IndexedDB simulado — como duas abas do mesmo navegador.
 */
const ctl = vi.hoisted(() => ({
  chamadas: [] as { entidade: string; ate: string | null; desde: string | null; apos: { t: string | null; id: string } | null }[],
  atrasoMs: 0,
  /** A chamada de número N fica presa até `liberarPendurada()` (aba congelada / sem rede) e depois segue normalmente. */
  pendurarNaChamada: null as number | null,
  liberarPendurada: null as null | (() => void),
  aoPendurar: null as null | (() => void),
  depoisDaPagina: null as null | ((n: number) => Promise<void>),
}));

vi.mock("@/lib/offline-sync/actions", async () => {
  const { validarEntradaPagina } = await import("@/lib/offline-sync/validar-pagina");
  const { instantesDaRodada, lerPaginaCatalogo } = await import("@/services/catalogo-sync.service");
  return {
    buscarPaginaCatalogoAction: async (entrada: unknown) => {
      const v = validarEntradaPagina(entrada);
      ctl.chamadas.push({ entidade: v.entidade, ate: v.ate, desde: v.desde, apos: v.apos });
      const n = ctl.chamadas.length;
      if (ctl.pendurarNaChamada === n) {
        await new Promise<void>((r) => {
          ctl.liberarPendurada = r;
          ctl.aoPendurar?.();
        });
      }
      if (ctl.atrasoMs) await new Promise((r) => setTimeout(r, ctl.atrasoMs));
      const instantes = v.ate ? null : await instantesDaRodada();
      const ate = v.ate ?? (instantes as { ate: string }).ate;
      const { itens, proximo, vendas_no_servidor } = await lerPaginaCatalogo(v.entidade, { desde: v.desde, ate, apos: v.apos }, v.tamanho, v.vendas_locais);
      if (ctl.depoisDaPagina) await ctl.depoisDaPagina(n);
      return { ate, marca: instantes?.marca, itens, proximo, vendas_no_servidor };
    },
    buscarCredenciaisPinOfflineAction: async () => ({ ok: true, credenciais: [] }),
  };
});

import { prisma } from "@/services/prisma/client";
import { instantesDaRodada } from "@/services/catalogo-sync.service";

const CARIMBO = "ultima_sincronizacao_catalogo";
const PROGRESSO = "progresso_sincronizacao_catalogo";
const TRAVA = "trava_sincronizacao_catalogo";

let categoria = "";

async function limparServidor() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "movimentacoes_estoque", "itens_venda", "vendas", "produtos", "clientes", "categorias", "funcionarios" RESTART IDENTITY CASCADE'
  );
}

/** Abre uma "aba": módulos novos (estado em memória próprio) sobre o mesmo IndexedDB. */
async function abrirAba() {
  vi.resetModules();
  // uma única conexão com o PostgreSQL para todas as "abas" (não vazar um pool novo a cada reinício de módulos)
  vi.doMock("@/services/prisma/client", () => ({ prisma }));
  const sinc = await import("../sincronizacao-catalogo.service");
  const trava = await import("../trava-sincronizacao.service");
  const cat = await import("@/lib/offline-sync/catalogo-paginas");
  const db = (await import("../db")).getOfflineDB();
  trava.AJUSTES_TRAVA.esperaMs = 30;
  return {
    sincronizar: sinc.sincronizarCatalogo,
    ajustesTrava: trava.AJUSTES_TRAVA,
    ajustesSync: cat.AJUSTES_SINCRONIZACAO,
    db,
  };
}
type Aba = Awaited<ReturnType<typeof abrirAba>>;

async function limparAparelho(aba: Aba) {
  const db = aba.db;
  await Promise.all([
    db.produtos_local.clear(), db.categorias_local.clear(), db.estoque_local.clear(), db.funcionarios_local.clear(),
    db.clientes_local.clear(), db.configuracoes_local.clear(), db.eventos_sincronizacao.clear(),
  ]);
}

async function criarProdutos(n: number, prefixo = "Produto") {
  await prisma.$executeRawUnsafe(
    `INSERT INTO produtos (nome, categoria_id, preco_venda) SELECT '${prefixo} ' || g, '${categoria}'::uuid, 5 FROM generate_series(1, ${n}) g`
  );
}
const idsServidor = async () => (await prisma.produto.findMany({ select: { id: true } })).map((x) => x.id).sort();
const idsLocais = async (aba: Aba) => (await aba.db.produtos_local.toArray()).map((x) => x.id).sort();
const config = async (aba: Aba, chave: string) => (await aba.db.configuracoes_local.get(chave))?.valor;

beforeEach(async () => {
  ctl.chamadas = [];
  ctl.atrasoMs = 0;
  ctl.pendurarNaChamada = null;
  ctl.liberarPendurada = null;
  ctl.aoPendurar = null;
  ctl.depoisDaPagina = null;
  await limparServidor();
  categoria = (await prisma.categoria.create({ data: { nome: "Geral" } })).id;
});

afterAll(async () => {
  await limparServidor();
  await prisma.$disconnect();
});

describe("duas abas SEM Web Locks", () => {
  it("o ambiente de teste realmente não tem Web Locks", () => {
    expect((globalThis as { navigator?: { locks?: unknown } }).navigator?.locks).toBeUndefined();
  });

  it("sincronizações simultâneas de duas abas rodam em série; progresso e cursor não se misturam", async () => {
    await criarProdutos(1100);
    const A = await abrirAba();
    const B = await abrirAba();
    await limparAparelho(A);
    ctl.atrasoMs = 3;

    const [ra, rb] = await Promise.all([A.sincronizar(), B.sincronizar()]);
    expect(ra.sucesso && rb.sucesso).toBe(true);
    expect(await idsLocais(A)).toEqual(await idsServidor());

    // rodada de uma aba inteira ANTES da outra começar: só duas chamadas com `ate` nulo e nenhuma alternância
    const sequencia = ctl.chamadas.map((c) => c.ate);
    const iniciosDeRodada = sequencia.flatMap((a, i) => (a === null ? [i] : []));
    expect(iniciosDeRodada).toHaveLength(2);
    const primeira = sequencia.slice(0, iniciosDeRodada[1]).filter((a) => a !== null);
    const segunda = sequencia.slice(iniciosDeRodada[1]).filter((a) => a !== null);
    expect(new Set(primeira).size).toBe(1);
    expect(new Set(segunda).size).toBe(1);
    expect(await config(A, PROGRESSO)).toBeUndefined();
    expect(await config(A, TRAVA)).toBeUndefined(); // licença devolvida
  });

  it("aba que morre no meio (licença vencida): a outra assume, retoma do progresso salvo e conclui; a aba velha, ao acordar, não grava nada", async () => {
    await criarProdutos(1300);
    const A = await abrirAba();
    const B = await abrirAba();
    await limparAparelho(A);
    for (const x of [A, B]) {
      x.ajustesTrava.validadeMs = 400;
      x.ajustesTrava.renovarACadaMs = 3_600_000; // sem renovação: uma aba congelada não renova
    }

    // A começa e congela na 4ª chamada (3ª página de produtos), depois de gravar 2 páginas
    ctl.pendurarNaChamada = 4;
    const pendente = new Promise<void>((r) => {
      ctl.aoPendurar = () => {
        ctl.pendurarNaChamada = null; // só a aba A congela; a retomada de B não pode congelar também
        r();
      };
    });
    const sincA = A.sincronizar();
    await pendente;
    const ateDeA = JSON.parse((await config(A, PROGRESSO)) as string).ate as string;
    expect(await A.db.produtos_local.count()).toBe(1000);

    // B tenta enquanto a licença de A ainda vale e só entra quando ela vence
    ctl.chamadas = [];
    const inicio = Date.now();
    const rb = await B.sincronizar();
    expect(Date.now() - inicio).toBeGreaterThanOrEqual(250); // esperou a licença vencer
    expect(rb.sucesso).toBe(true);
    // retomou do progresso de A: 1ª chamada já com cursor, mesma janela, sem refazer categorias nem produtos já lidos
    expect(ctl.chamadas[0].entidade).toBe("produtos");
    expect(ctl.chamadas[0].apos).not.toBeNull();
    expect(ctl.chamadas.every((c) => c.ate === ateDeA)).toBe(true);
    expect(await idsLocais(B)).toEqual(await idsServidor());
    const cursorDeB = await config(B, CARIMBO);
    expect(cursorDeB).toBeTruthy();

    // A acorda: a página que ela tinha pedido chega, mas a licença já não é dela
    ctl.chamadas = [];
    (ctl.liberarPendurada as () => void)();
    const ra = await sincA;
    expect(ra.sucesso).toBe(false);
    expect(ra.erro).toMatch(/assumida por outra aba/);
    expect(await config(B, CARIMBO)).toBe(cursorDeB); // cursor não regrediu nem mudou
    expect(await config(B, PROGRESSO)).toBeUndefined(); // progresso não foi ressuscitado
    expect(await idsLocais(B)).toEqual(await idsServidor()); // dados intactos, sem duplicar
  });

  it("CERCA: licença tomada no meio da rodada aborta a aba antiga SEM gravar a página, o progresso nem o cursor", async () => {
    await criarProdutos(1300);
    const A = await abrirAba();
    await limparAparelho(A);
    ctl.depoisDaPagina = async (n) => {
      if (n === 3) {
        // outra aba assume a licença (a de A venceu) depois da 1ª página de produtos gravada e da 2ª já lida
        await A.db.configuracoes_local.put({ chave: TRAVA, valor: JSON.stringify({ dono: "outra-aba", expira_em: Date.now() + 60_000 }) });
      }
    };
    const antes = { p: 0 };
    const r = await A.sincronizar();
    expect(r.sucesso).toBe(false);
    expect(r.erro).toMatch(/assumida por outra aba/);
    expect(await A.db.produtos_local.count()).toBe(500); // a 2ª página de produtos (já lida) NÃO foi gravada
    expect(JSON.parse((await config(A, PROGRESSO)) as string).cursores.produtos).toBeTruthy(); // progresso = o da 2ª página
    expect(await config(A, CARIMBO)).toBeUndefined();
    // e a licença da outra aba NÃO foi apagada pela aba antiga ao sair
    expect(JSON.parse((await config(A, TRAVA)) as string).dono).toBe("outra-aba");
    antes.p = 1;
  });

  it("licença viva de outra aba faz esperar; licença vencida (aba morta) é assumida na hora", async () => {
    await criarProdutos(20);
    const A = await abrirAba();
    await limparAparelho(A);

    await A.db.configuracoes_local.put({ chave: TRAVA, valor: JSON.stringify({ dono: "morta", expira_em: Date.now() - 1000 }) });
    let t0 = Date.now();
    expect((await A.sincronizar()).sucesso).toBe(true);
    expect(Date.now() - t0).toBeLessThan(2000);

    await A.db.configuracoes_local.clear();
    await A.db.configuracoes_local.put({ chave: TRAVA, valor: JSON.stringify({ dono: "viva", expira_em: Date.now() + 400 }) });
    t0 = Date.now();
    expect((await A.sincronizar()).sucesso).toBe(true);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(300);
  });

  it("com Web Locks disponível, a licença esquecida por uma aba morta não atrasa (a exclusão já está garantida)", async () => {
    await criarProdutos(20);
    const A = await abrirAba();
    await limparAparelho(A);
    await A.db.configuracoes_local.put({ chave: TRAVA, valor: JSON.stringify({ dono: "morta", expira_em: Date.now() + 60_000 }) });
    vi.stubGlobal("navigator", { locks: { request: (_n: string, fn: () => Promise<unknown>) => fn() } });
    try {
      const t0 = Date.now();
      expect((await A.sincronizar()).sucesso).toBe(true);
      expect(Date.now() - t0).toBeLessThan(5000);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("cursor nunca regride; repetição não duplica", () => {
  it("três rodadas seguidas (e uma de outra aba): cursores crescentes, dados estáveis", async () => {
    await criarProdutos(700);
    const A = await abrirAba();
    const B = await abrirAba();
    await limparAparelho(A);
    const cursores: number[] = [];
    for (const aba of [A, B, A, B]) {
      expect((await aba.sincronizar()).sucesso).toBe(true);
      cursores.push(Date.parse((await config(aba, CARIMBO)) as string));
    }
    expect(cursores).toEqual([...cursores].sort((a, b) => a - b));
    expect(await idsLocais(A)).toEqual(await idsServidor());
    expect(await A.db.produtos_local.count()).toBe(700);
  });

  it("um cursor MAIS NOVO já gravado não é substituído por um mais antigo", async () => {
    await criarProdutos(10);
    const A = await abrirAba();
    await limparAparelho(A);
    await A.sincronizar();
    const futuro = new Date(Date.now() + 3_600_000).toISOString();
    await A.db.configuracoes_local.put({ chave: CARIMBO, valor: futuro });
    await A.sincronizar();
    expect(await config(A, CARIMBO)).toBe(futuro);
  });
});

describe("transações demoradas no PostgreSQL", () => {
  /** Abre uma transação, grava, e a mantém ABERTA até `fechar()`. */
  async function transacaoAberta(gravar: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<void>) {
    let fechar!: () => void;
    const portao = new Promise<void>((r) => (fechar = r));
    let gravou!: () => void;
    const jaGravou = new Promise<void>((r) => (gravou = r));
    const concluida = prisma.$transaction(
      async (tx) => {
        await gravar(tx);
        gravou();
        await portao;
      },
      { timeout: 60_000, maxWait: 10_000 }
    );
    await jaGravou;
    return { fechar, concluida };
  }

  it("DEMONSTRAÇÃO: com cursor só por tempo, um INSERT confirmado depois da margem some para sempre", async () => {
    const MARGEM = 200;
    const aberta = await transacaoAberta(async (tx) => {
      await tx.$executeRawUnsafe(`INSERT INTO produtos (nome, categoria_id, preco_venda) VALUES ('Tardio', '${categoria}'::uuid, 5)`);
    });
    await new Promise((r) => setTimeout(r, MARGEM + 300)); // a transação já está aberta há mais que a margem
    const cursorSoPorTempo = Date.parse((await instantesDaRodada()).ate); // o que uma rodada gravaria sem horizonte
    aberta.fechar();
    await aberta.concluida;
    const visiveis = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM produtos WHERE nome = 'Tardio' AND updated_at >= ${new Date(cursorSoPorTempo - MARGEM)}`;
    expect(Number(visiveis[0].n)).toBe(0); // a linha existe, mas a janela por tempo nunca mais a alcança
    expect(await prisma.produto.count({ where: { nome: "Tardio" } })).toBe(1);
  });

  it("com o horizonte (marca), o mesmo INSERT tardio é entregue ao aparelho — por mais que a transação demore", async () => {
    const A = await abrirAba();
    await limparAparelho(A);
    A.ajustesSync.sobreposicaoMs = 200; // margem curta: o que protege aqui é a marca, não o tempo
    await criarProdutos(5);
    expect((await A.sincronizar()).sucesso).toBe(true);

    const aberta = await transacaoAberta(async (tx) => {
      await tx.$executeRawUnsafe(`INSERT INTO produtos (nome, categoria_id, preco_venda) VALUES ('Tardio', '${categoria}'::uuid, 5)`);
    });
    await new Promise((r) => setTimeout(r, 300));
    expect((await A.sincronizar()).sucesso).toBe(true); // rodada enquanto a transação está aberta: o Tardio ainda é invisível
    const cursorDuranteATransacao = Date.parse((await config(A, CARIMBO)) as string);
    await new Promise((r) => setTimeout(r, 700)); // muito além da margem de 200 ms
    aberta.fechar();
    await aberta.concluida;

    const tardio = await prisma.produto.findFirstOrThrow({ where: { nome: "Tardio" } });
    expect(tardio.updated_at.getTime()).toBeLessThan(cursorDuranteATransacao - A.ajustesSync.sobreposicaoMs + 1000); // data antiga, como no cenário real
    expect((await A.sincronizar()).sucesso).toBe(true);
    expect(await A.db.produtos_local.get(tardio.id)).toBeTruthy();
    expect(await A.db.produtos_local.count()).toBe(6);
  });

  it("UPDATE em transação demorada de produto já sincronizado também chega", async () => {
    const A = await abrirAba();
    await limparAparelho(A);
    A.ajustesSync.sobreposicaoMs = 100;
    await criarProdutos(5);
    await A.sincronizar();
    const alvo = await prisma.produto.findFirstOrThrow();
    const aberta = await transacaoAberta(async (tx) => {
      await tx.produto.update({ where: { id: alvo.id }, data: { nome: "Renomeado em transação longa" } });
    });
    await new Promise((r) => setTimeout(r, 300));
    await A.sincronizar();
    await new Promise((r) => setTimeout(r, 500));
    aberta.fechar();
    await aberta.concluida;
    await A.sincronizar();
    expect((await A.db.produtos_local.get(alvo.id))?.nome).toBe("Renomeado em transação longa");
  });

  it("uma transação que nunca fecha não trava a entrega do resto (só aumenta a releitura)", async () => {
    const A = await abrirAba();
    await limparAparelho(A);
    await criarProdutos(5);
    const aberta = await transacaoAberta(async (tx) => {
      await tx.$executeRawUnsafe(`INSERT INTO produtos (nome, categoria_id, preco_venda) VALUES ('Preso', '${categoria}'::uuid, 5)`);
    });
    try {
      await A.sincronizar();
      await prisma.$executeRawUnsafe(`INSERT INTO produtos (nome, categoria_id, preco_venda) VALUES ('Normal', '${categoria}'::uuid, 5)`);
      expect((await A.sincronizar()).sucesso).toBe(true);
      const normal = await prisma.produto.findFirstOrThrow({ where: { nome: "Normal" } });
      expect(await A.db.produtos_local.get(normal.id)).toBeTruthy();
    } finally {
      aberta.fechar();
      await aberta.concluida;
    }
  });

  it("sem transações abertas, a marca é praticamente o próprio instante da rodada", async () => {
    const { ate, marca } = await instantesDaRodada();
    expect(Date.parse(marca)).toBeLessThanOrEqual(Date.parse(ate));
    expect(Date.parse(ate) - Date.parse(marca)).toBeLessThan(2000);
  });
});
