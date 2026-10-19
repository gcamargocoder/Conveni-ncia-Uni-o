import { prisma } from "./prisma/client";
import { executar } from "./prisma/query-helpers";

const VERSAO_BACKUP = 1;

// Ordem respeita as chaves estrangeiras (quem é referenciado vem antes).
const TABELAS_EM_ORDEM = [
  "categorias",
  "fornecedores",
  "funcionarios",
  "clientes",
  "produtos",
  "vendas",
  "itens_venda",
  "movimentacoes_estoque",
  "contas_receber",
  "recebimentos",
] as const;

export type NomeTabelaBackup = (typeof TABELAS_EM_ORDEM)[number];

interface DelegateGenerico {
  findMany: () => Promise<unknown>;
  upsert: (args: { where: { id: string }; create: unknown; update: unknown }) => Promise<unknown>;
}

// Nome do delegate do Prisma de cada tabela (todas têm `id` como chave primária).
const DELEGATES: Record<NomeTabelaBackup, string> = {
  categorias: "categoria",
  fornecedores: "fornecedor",
  funcionarios: "funcionario",
  clientes: "cliente",
  produtos: "produto",
  vendas: "venda",
  itens_venda: "itemVenda",
  movimentacoes_estoque: "movimentacaoEstoque",
  contas_receber: "contaReceber",
  recebimentos: "recebimento",
};

function delegateDe(cliente: object, tabela: NomeTabelaBackup): DelegateGenerico {
  return (cliente as Record<string, DelegateGenerico>)[DELEGATES[tabela]];
}

export interface BackupCompleto {
  versao: number;
  geradoEm: string;
  dados: Record<NomeTabelaBackup, any[]>;
}

export async function gerarBackupCompleto(): Promise<BackupCompleto> {
  const dados = {} as Record<NomeTabelaBackup, any[]>;

  for (const tabela of TABELAS_EM_ORDEM) {
    dados[tabela] = await executar(() => delegateDe(prisma, tabela).findMany(), `Erro ao exportar tabela ${tabela}`);
  }

  return { versao: VERSAO_BACKUP, geradoEm: new Date().toISOString(), dados };
}

export interface ContagemRestauracao {
  tabela: NomeTabelaBackup;
  registros: number;
}

export async function restaurarBackup(backup: BackupCompleto): Promise<ContagemRestauracao[]> {
  const resultado: ContagemRestauracao[] = [];

  for (const tabela of TABELAS_EM_ORDEM) {
    const linhas = backup.dados[tabela];
    if (!Array.isArray(linhas) || linhas.length === 0) {
      resultado.push({ tabela, registros: 0 });
      continue;
    }

    // Upsert por id numa transação por tabela: ou restaura a tabela inteira, ou nada.
    await executar(
      () =>
        prisma.$transaction(
          async (tx) => {
            const delegate = delegateDe(tx, tabela);
            for (const linha of linhas) {
              await delegate.upsert({ where: { id: linha.id }, create: linha, update: linha });
            }
          },
          { timeout: 120_000 }
        ),
      `Erro ao restaurar tabela ${tabela}`
    );
    resultado.push({ tabela, registros: linhas.length });
  }

  return resultado;
}
