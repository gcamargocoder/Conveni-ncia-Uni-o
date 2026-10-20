import { getOfflineDB, CredencialPinLocal } from "./db";
import { registrarLog } from "./logs.service";
import { buscarCredenciaisPinOfflineAction } from "@/lib/offline-sync/actions";

/**
 * Verificadores de PIN para o PDV offline (tabela própria, fora do catálogo).
 * O servidor só envia os de funcionários ATIVOS cujo cargo apenas vende, e a lista é
 * sempre substituída por inteiro: quem foi desativado, removido ou promovido some do
 * aparelho na próxima sincronização online. Apagada no logout.
 */

export async function substituirCredenciaisPinLocal(credenciais: { funcionario_id: string; pin_hash: string }[]): Promise<void> {
  const db = getOfflineDB();
  const agora = new Date().toISOString();
  const linhas: CredencialPinLocal[] = credenciais.map((c) => ({ ...c, atualizado_em: agora }));
  await db.transaction("rw", db.credenciais_pin_local, async () => {
    await db.credenciais_pin_local.clear();
    if (linhas.length) await db.credenciais_pin_local.bulkPut(linhas);
  });
}

export async function limparCredenciaisPinLocal(): Promise<void> {
  try {
    await getOfflineDB().credenciais_pin_local.clear();
  } catch {
    // IndexedDB indisponível: não há o que limpar
  }
}

/** Busca no servidor e substitui. Falhas não derrubam a sincronização do catálogo. */
export async function sincronizarCredenciaisPin(): Promise<boolean> {
  try {
    const resposta = await buscarCredenciaisPinOfflineAction();
    if (!resposta.ok) return false;
    await substituirCredenciaisPinLocal(resposta.credenciais);
    return true;
  } catch (e) {
    await registrarLog("PIN", "aviso", "Não foi possível atualizar os PINs offline", (e as Error).message).catch(() => undefined);
    return false;
  }
}
