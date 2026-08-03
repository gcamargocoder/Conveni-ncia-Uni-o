import { createSupabaseServerClient } from "./supabase/server";
import { unwrap } from "./supabase/query-helpers";

const VERSAO_BACKUP = 1;

const TABELAS_EM_ORDEM = [
  "categorias",
  "produtos",
  "fornecedores",
  "funcionarios",
  "clientes",
  "vendas",
  "itens_venda",
  "movimentacoes_estoque",
  "contas_receber",
  "recebimentos",
] as const;

export type NomeTabelaBackup = (typeof TABELAS_EM_ORDEM)[number];

export interface BackupCompleto {
  versao: number;
  geradoEm: string;
  dados: Record<NomeTabelaBackup, any[]>;
}

export async function gerarBackupCompleto(): Promise<BackupCompleto> {
  const supabase = await createSupabaseServerClient();
  const dados = {} as Record<NomeTabelaBackup, any[]>;

  for (const tabela of TABELAS_EM_ORDEM) {
    const resultado = await supabase.from(tabela).select("*");
    dados[tabela] = unwrap(resultado, `Erro ao exportar tabela ${tabela}`);
  }

  return { versao: VERSAO_BACKUP, geradoEm: new Date().toISOString(), dados };
}

export interface ContagemRestauracao {
  tabela: NomeTabelaBackup;
  registros: number;
}

export async function restaurarBackup(backup: BackupCompleto): Promise<ContagemRestauracao[]> {
  const supabase = await createSupabaseServerClient();
  const resultado: ContagemRestauracao[] = [];

  for (const tabela of TABELAS_EM_ORDEM) {
    const linhas = backup.dados[tabela];
    if (!Array.isArray(linhas) || linhas.length === 0) {
      resultado.push({ tabela, registros: 0 });
      continue;
    }

    const respostaUpsert = await supabase.from(tabela).upsert(linhas, { onConflict: "id" });
    unwrap(respostaUpsert, `Erro ao restaurar tabela ${tabela}`);
    resultado.push({ tabela, registros: linhas.length });
  }

  return resultado;
}