"use client";

import { useState, useRef } from "react";
import { Download, Upload, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Alert } from "@/components/ui/Alert";
import { useToast } from "@/components/ui/ToastProvider";
import { gerarBackupAction, restaurarBackupAction } from "@/lib/backup/actions";
import type { BackupCompleto, ContagemRestauracao } from "@/services/backup.service";

export function PainelBackup() {
  const [gerando, setGerando] = useState(false);
  const [arquivoSelecionado, setArquivoSelecionado] = useState<BackupCompleto | null>(null);
  const [nomeArquivo, setNomeArquivo] = useState("");
  const [erroLeitura, setErroLeitura] = useState<string | null>(null);
  const [restaurando, setRestaurando] = useState(false);
  const [resultadoRestauracao, setResultadoRestauracao] = useState<ContagemRestauracao[] | null>(null);
  const inputArquivoRef = useRef<HTMLInputElement>(null);
  const { mostrar } = useToast();

  async function baixarBackup() {
    setGerando(true);
    const resultado = await gerarBackupAction();
    setGerando(false);

    if (!resultado.sucesso || !resultado.backup) {
      mostrar("danger", resultado.erro ?? "Erro ao gerar backup.");
      return;
    }

    const conteudo = JSON.stringify(resultado.backup, null, 2);
    const blob = new Blob([conteudo], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const data = new Date().toISOString().slice(0, 10);

    const link = document.createElement("a");
    link.href = url;
    link.download = `backup-conveniencia-uniao-${data}.json`;
    link.click();
    URL.revokeObjectURL(url);

    mostrar("success", "Backup baixado.");
  }

  function aoEscolherArquivo(evento: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = evento.target.files?.[0];
    if (!arquivo) return;

    setErroLeitura(null);
    setResultadoRestauracao(null);
    setNomeArquivo(arquivo.name);

    const leitor = new FileReader();
    leitor.onload = () => {
      try {
        const json = JSON.parse(leitor.result as string);
        if (!json || typeof json !== "object" || !json.dados) {
          setErroLeitura("Este arquivo não parece ser um backup válido (faltando a chave \"dados\").");
          setArquivoSelecionado(null);
          return;
        }
        setArquivoSelecionado(json as BackupCompleto);
      } catch {
        setErroLeitura("Não foi possível ler este arquivo — confirma que é o .json exportado pelo backup.");
        setArquivoSelecionado(null);
      }
    };
    leitor.readAsText(arquivo);
  }

  async function confirmarRestauracao() {
    if (!arquivoSelecionado) return;
    setRestaurando(true);
    const resultado = await restaurarBackupAction(arquivoSelecionado);
    setRestaurando(false);

    if (!resultado.sucesso) {
      mostrar("danger", resultado.erro ?? "Erro ao restaurar backup.");
      return;
    }

    setResultadoRestauracao(resultado.contagens ?? []);
    setArquivoSelecionado(null);
    setNomeArquivo("");
    if (inputArquivoRef.current) inputArquivoRef.current.value = "";
    mostrar("success", "Backup restaurado.");
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex items-center gap-2 mb-3">
          <Download className="w-4 h-4 text-brand-700" />
          <h2 className="text-sm font-semibold text-slate-700">Baixar backup</h2>
        </div>
        <p className="text-sm text-slate-500 mb-4">
          Gera um arquivo <code className="text-xs bg-slate-100 px-1 rounded">.json</code> com todos os dados do
          sistema (produtos, categorias, fornecedores, funcionários, clientes, vendas, estoque e contas a
          receber) — guarde num lugar seguro (pen drive, e-mail, nuvem própria).
        </p>
        <Button onClick={baixarBackup} carregando={gerando} disabled={gerando}>
          <Download className="w-4 h-4" />
          Baixar backup completo
        </Button>
      </Card>

      <Card>
        <div className="flex items-center gap-2 mb-3">
          <Upload className="w-4 h-4 text-brand-700" />
          <h2 className="text-sm font-semibold text-slate-700">Restaurar backup</h2>
        </div>
        <p className="text-sm text-slate-500 mb-4">
          Envia um arquivo <code className="text-xs bg-slate-100 px-1 rounded">.json</code> gerado pelo botão
          acima (deste sistema, ou de outra instalação dele) para trazer os dados de volta. Registros que já
          existem são atualizados; os que não existem são criados. <strong>Nada é apagado</strong> — dados que já
          estão no sistema e não vierem no arquivo continuam intactos.
        </p>

        <input
          ref={inputArquivoRef}
          type="file"
          accept="application/json"
          onChange={aoEscolherArquivo}
          className="text-sm"
        />

        {erroLeitura && (
          <div className="mt-3">
            <Alert variante="danger">{erroLeitura}</Alert>
          </div>
        )}

        {resultadoRestauracao && (
          <div className="mt-4 rounded-lg bg-success-50 p-3">
            <p className="text-sm font-semibold text-success-700 mb-1.5">Restauração concluída:</p>
            <ul className="text-xs text-slate-600 flex flex-col gap-0.5">
              {resultadoRestauracao
                .filter((c) => c.registros > 0)
                .map((c) => (
                  <li key={c.tabela}>
                    {c.tabela}: {c.registros} registro(s)
                  </li>
                ))}
            </ul>
          </div>
        )}
      </Card>

      <Modal
        aberto={!!arquivoSelecionado}
        titulo="Confirmar restauração"
        onFechar={() => {
          setArquivoSelecionado(null);
          setNomeArquivo("");
          if (inputArquivoRef.current) inputArquivoRef.current.value = "";
        }}
        rodape={
          <>
            <Button
              variante="secondary"
              tamanho="sm"
              onClick={() => {
                setArquivoSelecionado(null);
                setNomeArquivo("");
                if (inputArquivoRef.current) inputArquivoRef.current.value = "";
              }}
            >
              Cancelar
            </Button>
            <Button variante="danger" tamanho="sm" onClick={confirmarRestauracao} carregando={restaurando}>
              Restaurar agora
            </Button>
          </>
        }
      >
        <div className="flex items-start gap-2.5">
          <AlertTriangle className="w-5 h-5 text-warning-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-slate-700">
              Arquivo selecionado: <strong>{nomeArquivo}</strong>
            </p>
            <p className="text-sm text-slate-500 mt-2">
              Isso vai atualizar registros existentes (mesmo ID) e criar os que não existem ainda. Confirma que
              este é o arquivo certo antes de continuar.
            </p>
          </div>
        </div>
      </Modal>
    </div>
  );
}