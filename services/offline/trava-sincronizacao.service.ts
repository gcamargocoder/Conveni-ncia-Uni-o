import { getOfflineDB } from "./db";
import { gerarUuid } from "@/lib/utils/uuid";

/**
 * Exclusão mútua da sincronização do catálogo ENTRE ABAS, sem depender de Web Locks (que não existe em páginas HTTP
 * da rede local nem em navegadores antigos).
 *
 * Mecanismo: uma "licença" (lease) gravada no IndexedDB, que todas as abas do mesmo navegador compartilham.
 * - Adquirir = ler e gravar o registro numa transação `rw` (as transações do IndexedDB sobre o mesmo armazenamento são
 *   serializadas entre abas): só uma aba vence a corrida.
 * - A licença expira (`expira_em`) e é renovada enquanto a aba vive; aba que travou/fechou deixa de renovar e outra
 *   assume depois do prazo.
 * - CERCA (fencing): toda gravação do catálogo/progresso/cursor confere, DENTRO da mesma transação da gravação, que a
 *   licença ainda é desta aba. Uma aba que ficou pausada e perdeu a licença não consegue gravar mais nada — nem página,
 *   nem progresso, nem cursor. Por isso progresso e cursor não regridem nem se misturam, mesmo que a exclusão falhe.
 */
const CHAVE_TRAVA = "trava_sincronizacao_catalogo";

/** Mutável só para os testes encurtarem os prazos. */
export const AJUSTES_TRAVA = { validadeMs: 60_000, renovarACadaMs: 10_000, esperaMs: 250, esperaMaximaMs: 180_000 };

export class TravaPerdidaError extends Error {
  constructor() {
    super("A sincronização foi assumida por outra aba; esta rodada parou sem gravar mais nada.");
    this.name = "TravaPerdidaError";
  }
}

interface Registro {
  dono: string;
  expira_em: number;
}

function lerRegistro(valor: string | undefined): Registro | null {
  if (!valor) return null;
  try {
    const r = JSON.parse(valor) as Registro;
    return typeof r?.dono === "string" && typeof r.expira_em === "number" ? r : null;
  } catch {
    return null; // registro ilegível = sem dono
  }
}

export interface Trava {
  readonly dono: string;
  /**
   * Chamar DENTRO de uma transação `rw` que inclua `configuracoes_local`, junto com a gravação protegida: confere que a
   * licença continua desta aba (senão lança TravaPerdidaError, abortando a transação inteira) e a prorroga.
   */
  verificarERenovar(): Promise<void>;
  liberar(): Promise<void>;
}

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * `forcar`: só quando outra camada JÁ garante a exclusão (Web Locks): uma licença deixada por uma aba que morreu
 * pode ser assumida na hora, sem esperar o prazo.
 */
export async function adquirirTrava(opcoes: { forcar?: boolean } = {}): Promise<Trava> {
  const db = getOfflineDB();
  const dono = gerarUuid();
  const limite = Date.now() + AJUSTES_TRAVA.esperaMaximaMs;

  for (;;) {
    const venceu = await db.transaction("rw", db.configuracoes_local, async () => {
      const atual = lerRegistro((await db.configuracoes_local.get(CHAVE_TRAVA))?.valor);
      const agora = Date.now();
      if (atual && atual.expira_em > agora && !opcoes.forcar) return false;
      await db.configuracoes_local.put({ chave: CHAVE_TRAVA, valor: JSON.stringify({ dono, expira_em: agora + AJUSTES_TRAVA.validadeMs } satisfies Registro) });
      return true;
    });
    if (venceu) break;
    if (Date.now() > limite) throw new Error("Outra sincronização do catálogo está em andamento; tentará de novo.");
    await dormir(AJUSTES_TRAVA.esperaMs);
  }

  const verificarERenovar = async () => {
    const r = lerRegistro((await db.configuracoes_local.get(CHAVE_TRAVA))?.valor);
    if (!r || r.dono !== dono) throw new TravaPerdidaError();
    await db.configuracoes_local.put({ chave: CHAVE_TRAVA, valor: JSON.stringify({ dono, expira_em: Date.now() + AJUSTES_TRAVA.validadeMs } satisfies Registro) });
  };

  // Renovação enquanto a aba vive (além da renovada a cada página gravada).
  const timer = setInterval(() => {
    db.transaction("rw", db.configuracoes_local, verificarERenovar).catch(() => undefined);
  }, AJUSTES_TRAVA.renovarACadaMs);
  if (typeof timer === "object" && "unref" in timer) (timer as { unref: () => void }).unref();

  return {
    dono,
    verificarERenovar,
    async liberar() {
      clearInterval(timer);
      await db
        .transaction("rw", db.configuracoes_local, async () => {
          const r = lerRegistro((await db.configuracoes_local.get(CHAVE_TRAVA))?.valor);
          if (r?.dono === dono) await db.configuracoes_local.delete(CHAVE_TRAVA);
        })
        .catch(() => undefined);
    },
  };
}
