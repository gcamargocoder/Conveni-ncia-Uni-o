import { getOfflineDB, PapelDispositivo, TipoDispositivo } from "./db";

/**
 * Papel do dispositivo (Terminal Principal / Emergencial), conforme a
 * arquitetura v2. Nesta etapa só existe a leitura/escrita local — a
 * autorização de verdade contra o servidor (tabela
 * dispositivos_autorizados) é uma etapa futura. Sem papel definido,
 * o dispositivo não deve ser tratado como autorizado a vender offline
 * (isso será decidido na etapa que integrar o PDV, não aqui).
 */

const CHAVE = "papel_dispositivo" as const;

export async function obterPapelDispositivo(): Promise<PapelDispositivo | undefined> {
  const db = getOfflineDB();
  return db.papel_dispositivo.get(CHAVE);
}

export async function definirPapelDispositivo(
  tipo: TipoDispositivo,
  ativo: boolean
): Promise<void> {
  const db = getOfflineDB();
  await db.papel_dispositivo.put({ chave: CHAVE, tipo, ativo });
}
