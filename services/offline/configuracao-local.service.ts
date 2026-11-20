import { getOfflineDB } from "./db";
import { gerarUuid } from "@/lib/utils/uuid";

export async function obterConfiguracao(chave: string): Promise<string | undefined> {
  const db = getOfflineDB();
  const registro = await db.configuracoes_local.get(chave);
  return registro?.valor;
}

export async function definirConfiguracao(chave: string, valor: string): Promise<void> {
  const db = getOfflineDB();
  await db.configuracoes_local.put({ chave, valor });
}

/**
 * Identificador deste dispositivo, SOMENTE LEITURA (nunca cria). Telas que consultam o IndexedDB ao vivo
 * (useLiveQuery) rodam em transação de leitura: criar o identificador ali dá ReadOnlyError.
 */
export async function lerIdentificadorDispositivo(): Promise<string | undefined> {
  return obterConfiguracao("dispositivo_id");
}

/**
 * Identificador único deste dispositivo/navegador. Gerado uma vez e
 * persistido — usado para saber "quem" sincronizou o quê (auditoria)
 * e, numa etapa futura, para checar autorização de Terminal Emergencial.
 */
export async function obterOuCriarIdentificadorDispositivo(): Promise<string> {
  const db = getOfflineDB();
  // Leitura + criação na MESMA transação: chamadas simultâneas na primeira execução (duas abas, abrir
  // caixa e vender ao mesmo tempo) recebem o mesmo identificador. O caixa pertence a este terminal.
  return db.transaction("rw", db.configuracoes_local, async () => {
    const existente = await db.configuracoes_local.get("dispositivo_id");
    if (existente) return existente.valor;
    const novo = gerarUuid();
    await db.configuracoes_local.put({ chave: "dispositivo_id", valor: novo });
    return novo;
  });
}