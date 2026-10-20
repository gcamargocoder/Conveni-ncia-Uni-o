"use server";

import { verificarAcesso } from "@/lib/auth/servidor";

import { gerarBackupCompleto, restaurarBackup, BackupCompleto, ContagemRestauracao } from "@/services/backup.service";

export interface ResultadoGerarBackup {
  sucesso: boolean;
  backup?: BackupCompleto;
  erro?: string;
}

export async function gerarBackupAction(): Promise<ResultadoGerarBackup> {
  const acesso = await verificarAcesso("admin");
  if (!acesso.ok) return { sucesso: false, erro: acesso.erro };
  try {
    const backup = await gerarBackupCompleto();
    return { sucesso: true, backup };
  } catch (e) {
    return { sucesso: false, erro: (e as Error).message };
  }
}

export interface ResultadoRestaurarBackup {
  sucesso: boolean;
  contagens?: ContagemRestauracao[];
  erro?: string;
}

export async function restaurarBackupAction(backup: BackupCompleto): Promise<ResultadoRestaurarBackup> {
  const acesso = await verificarAcesso("admin");
  if (!acesso.ok) return { sucesso: false, erro: acesso.erro };
  if (!backup || typeof backup !== "object" || !backup.dados) {
    return { sucesso: false, erro: "Arquivo de backup em formato inválido." };
  }

  try {
    const contagens = await restaurarBackup(backup);
    return { sucesso: true, contagens };
  } catch (e) {
    return { sucesso: false, erro: (e as Error).message };
  }
}