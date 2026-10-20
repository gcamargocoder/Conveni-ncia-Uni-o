"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { aprovarVendaRevisaoAction, rejeitarVendaRevisaoAction } from "@/lib/vendas/revisao-actions";
import type { VendaEmRevisao } from "@/services/vendas-sincronizadas.service";
import { EVENTO_ATUALIZAR_REVISAO } from "@/lib/vendas/eventos";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useToast } from "@/components/ui/ToastProvider";

function moeda(valor: number | null): string {
  return valor === null ? "—" : valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function VendaRevisaoCartao({ venda }: { venda: VendaEmRevisao }) {
  const [ocupado, setOcupado] = useState(false);
  const [observacao, setObservacao] = useState("");
  const { mostrar } = useToast();
  const router = useRouter();

  async function decidir(aprovar: boolean) {
    if (ocupado) return;
    const pergunta = aprovar
      ? "Aprovar esta venda com os valores informados? Ela entrará no faturamento e baixará o estoque."
      : "Rejeitar esta venda? Ela NÃO entrará no faturamento nem no estoque (o registro é mantido para auditoria).";
    if (!window.confirm(pergunta)) return;
    setOcupado(true);
    try {
      const r = aprovar
        ? await aprovarVendaRevisaoAction(venda.id, observacao || undefined)
        : await rejeitarVendaRevisaoAction(venda.id, observacao || undefined);
      if (r.sucesso) {
        mostrar("success", aprovar ? "Venda aprovada." : "Venda rejeitada.");
        window.dispatchEvent(new Event(EVENTO_ATUALIZAR_REVISAO));
        router.refresh();
      } else {
        mostrar("danger", r.erro ?? "Operação não concluída.");
        router.refresh(); // o servidor pode ter atualizado os motivos
      }
    } catch {
      mostrar("danger", "Sem conexão com o servidor.");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-900">
            {new Date(venda.criada_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })} ·{" "}
            {venda.forma_pagamento}
          </p>
          <p className="text-xs text-slate-500">
            Funcionário no PDV: {venda.funcionario_nome ?? "(não encontrado)"} · Enviada por: {venda.enviada_por ?? "—"}
          </p>
        </div>
        <p className="text-lg font-bold text-slate-900 tabular-nums">{moeda(venda.total_informado)}</p>
      </div>

      <ul className="flex flex-col gap-1">
        {venda.motivos.map((m, i) => (
          <li key={i} className="text-sm text-slate-700">
            <Badge variante={m.gravidade === "bloqueante" ? "danger" : "neutral"}>
              {m.gravidade === "bloqueante" ? "Impede aprovação" : "Divergência"}
            </Badge>{" "}
            {m.item !== undefined ? `Item ${m.item + 1}: ` : ""}
            {m.mensagem}
          </li>
        ))}
      </ul>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-500">
            <th className="py-1">Produto</th>
            <th className="py-1 text-right">Qtd</th>
            <th className="py-1 text-right">Preço informado</th>
            <th className="py-1 text-right">Preço cadastrado</th>
          </tr>
        </thead>
        <tbody>
          {venda.itens.map((i, idx) => (
            <tr key={idx} className="border-t border-slate-100">
              <td className="py-1.5">{i.produto_nome}</td>
              <td className="py-1.5 text-right tabular-nums">{i.quantidade}</td>
              <td className="py-1.5 text-right tabular-nums">{moeda(i.preco_informado)}</td>
              <td className="py-1.5 text-right tabular-nums">{moeda(i.preco_cadastrado)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
        <input
          value={observacao}
          onChange={(e) => setObservacao(e.target.value)}
          maxLength={500}
          placeholder="Observação (opcional)"
          className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
        <Button variante="secondary" disabled={ocupado} onClick={() => decidir(false)}>
          Rejeitar
        </Button>
        <Button
          disabled={ocupado || venda.bloqueante}
          onClick={() => decidir(true)}
          title={venda.bloqueante ? "Dados inválidos: não pode ser aprovada" : undefined}
        >
          Aprovar
        </Button>
      </div>
    </Card>
  );
}
