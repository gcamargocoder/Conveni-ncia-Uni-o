import { PainelBackup } from "@/components/backup/PainelBackup";
import { exigirAdmin } from "@/lib/auth/servidor";

export const dynamic = "force-dynamic";

export default async function BackupPage() {
  await exigirAdmin();
  return (
    <main className="max-w-2xl mx-auto px-6 py-8 flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Backup</h1>
        <p className="text-slate-500 text-sm">Baixar e restaurar os dados do sistema</p>
      </header>

      <PainelBackup />
    </main>
  );
}