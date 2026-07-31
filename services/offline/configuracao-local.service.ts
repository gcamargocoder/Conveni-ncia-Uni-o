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
 * Identificador único deste dispositivo/navegador. Gerado uma vez e
 * persistido — usado para saber "quem" sincronizou o quê (auditoria)
 * e, numa etapa futura, para checar autorização de Terminal Emergencial.
 */
export async function obterOuCriarIdentificadorDispositivo(): Promise<string> {
  const existente = await obterConfiguracao("dispositivo_id");
  if (existente) return existente;

  const novo = gerarUuid();
  await definirConfiguracao("dispositivo_id", novo);
  return novo;
}