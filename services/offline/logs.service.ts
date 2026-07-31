import { getOfflineDB, CategoriaLog, NivelLog, LogTecnico } from "./db";
import { gerarUuid } from "@/lib/utils/uuid";

export async function registrarLog(
  categoria: CategoriaLog,
  nivel: NivelLog,
  mensagem: string,
  detalhes?: string
): Promise<void> {
  const db = getOfflineDB();
  const log: LogTecnico = {
    id: gerarUuid(),
    categoria,
    nivel,
    mensagem,
    detalhes: detalhes ?? null,
    timestamp: new Date().toISOString(),
  };
  await db.logs_tecnicos.put(log);
}

export async function listarLogs(
  filtro?: { categoria?: CategoriaLog; nivel?: NivelLog },
  limite = 200
): Promise<LogTecnico[]> {
  const db = getOfflineDB();
  const colecao = db.logs_tecnicos.orderBy("timestamp").reverse();

  const todos = await colecao.limit(limite * 3).toArray();
  const filtrados = todos.filter(
    (l) => (!filtro?.categoria || l.categoria === filtro.categoria) && (!filtro?.nivel || l.nivel === filtro.nivel)
  );
  return filtrados.slice(0, limite);
}

export async function limparLogsAntigos(diasParaManter = 14): Promise<number> {
  const db = getOfflineDB();
  const limite = new Date();
  limite.setDate(limite.getDate() - diasParaManter);
  const limiteIso = limite.toISOString();

  const antigos = await db.logs_tecnicos.where("timestamp").below(limiteIso).toArray();
  await db.logs_tecnicos.bulkDelete(antigos.map((l) => l.id));
  return antigos.length;
}