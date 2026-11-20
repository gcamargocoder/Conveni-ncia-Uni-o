"use client";

import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { formatarCentavos, reaisParaCentavos } from "@/lib/caixa/calculo";
import type { DadosCartao } from "@/lib/caixa/tipos";
import type { PagamentoVenda } from "@/lib/caixa/validacao";
import type { FormaPagamento } from "@/types/venda";

export interface CartaoForm {
  bandeira: string;
  adquirente: string;
  parcelas: string;
  taxa: string;
  transacao: string;
}
export const CARTAO_VAZIO: CartaoForm = { bandeira: "", adquirente: "", parcelas: "", taxa: "", transacao: "" };

export interface LinhaPagamento {
  forma: FormaPagamento;
  valor: string;
  cartao: CartaoForm;
}

const ROTULOS: Record<FormaPagamento, string> = { dinheiro: "Dinheiro", pix: "Pix", debito: "Débito", credito: "Crédito", fiado: "Fiado" };

/** Só envia o que foi informado: taxa vazia = desconhecida (nunca presumida). */
export function cartaoParaDados(forma: FormaPagamento, c: CartaoForm): DadosCartao | null {
  if (forma !== "credito" && forma !== "debito") return null;
  const dados: DadosCartao = {};
  if (c.bandeira.trim()) dados.bandeira = c.bandeira.trim();
  if (c.adquirente.trim()) dados.adquirente = c.adquirente.trim();
  if (c.parcelas.trim()) dados.parcelas = Number(c.parcelas);
  else if (forma === "debito") dados.parcelas = 1;
  if (c.taxa.trim()) {
    const t = reaisParaCentavos(c.taxa);
    if (t !== null) dados.taxa_centavos = t;
  }
  if (c.transacao.trim()) dados.transacao_id = c.transacao.trim();
  return Object.keys(dados).length > 0 ? dados : null;
}

export function pagamentosDasLinhas(linhas: LinhaPagamento[]): PagamentoVenda[] | null {
  const lista: PagamentoVenda[] = [];
  for (const l of linhas) {
    const v = reaisParaCentavos(l.valor);
    if (v === null || v <= 0) return null;
    lista.push({ forma: l.forma, valor_centavos: v, cartao: cartaoParaDados(l.forma, l.cartao) });
  }
  return lista;
}

export function CamposCartao({ forma, valor, onChange }: { forma: FormaPagamento; valor: CartaoForm; onChange: (v: CartaoForm) => void }) {
  if (forma !== "credito" && forma !== "debito") return null;
  const set = (parte: Partial<CartaoForm>) => onChange({ ...valor, ...parte });
  return (
    <details className="rounded-xl border border-slate-200 px-3 py-2 text-sm">
      <summary className="cursor-pointer text-slate-600 font-medium">Dados do cartão (opcional)</summary>
      <div className="grid grid-cols-2 gap-2 mt-2">
        <Input rotulo="Bandeira" value={valor.bandeira} onChange={(e) => set({ bandeira: e.target.value })} maxLength={40} />
        <Input rotulo="Operadora" value={valor.adquirente} onChange={(e) => set({ adquirente: e.target.value })} maxLength={60} />
        {forma === "credito" && (
          <Input rotulo="Parcelas" inputMode="numeric" value={valor.parcelas} onChange={(e) => set({ parcelas: e.target.value.replace(/\D/g, "").slice(0, 2) })} />
        )}
        <Input rotulo="Taxa conhecida (R$)" inputMode="decimal" placeholder="vazio = desconhecida" value={valor.taxa} onChange={(e) => set({ taxa: e.target.value })} />
        <Input className="col-span-2" rotulo="ID da transação" value={valor.transacao} onChange={(e) => set({ transacao: e.target.value })} maxLength={80} />
      </div>
    </details>
  );
}

export function PagamentoDividido({
  linhas,
  onChange,
  totalCentavos,
}: {
  linhas: LinhaPagamento[];
  onChange: (l: LinhaPagamento[]) => void;
  totalCentavos: number;
}) {
  const soma = linhas.reduce((s, l) => s + (reaisParaCentavos(l.valor) ?? 0), 0);
  const restante = totalCentavos - soma;
  const atualizar = (i: number, parte: Partial<LinhaPagamento>) => onChange(linhas.map((l, j) => (j === i ? { ...l, ...parte } : l)));

  return (
    <div className="flex flex-col gap-3">
      {linhas.map((l, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-xl border border-slate-200 p-3">
          <div className="flex items-end gap-2">
            <Select className="flex-1" rotulo={`Forma ${i + 1}`} value={l.forma} onChange={(e) => atualizar(i, { forma: e.target.value as FormaPagamento })}>
              {(Object.keys(ROTULOS) as FormaPagamento[]).map((f) => (
                <option key={f} value={f}>
                  {ROTULOS[f]}
                </option>
              ))}
            </Select>
            <Input className="w-28" rotulo="Valor (R$)" inputMode="decimal" value={l.valor} onChange={(e) => atualizar(i, { valor: e.target.value })} />
            {linhas.length > 2 && (
              <button aria-label="Remover forma" className="h-11 text-slate-400 hover:text-slate-600" onClick={() => onChange(linhas.filter((_, j) => j !== i))}>
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <CamposCartao forma={l.forma} valor={l.cartao} onChange={(cartao) => atualizar(i, { cartao })} />
        </div>
      ))}
      <div className="flex items-center justify-between">
        <Button variante="ghost" tamanho="sm" onClick={() => onChange([...linhas, { forma: "dinheiro", valor: restante > 0 ? (restante / 100).toFixed(2).replace(".", ",") : "", cartao: CARTAO_VAZIO }])}>
          <Plus className="w-4 h-4" />
          Adicionar forma
        </Button>
        <span className={`text-sm font-semibold tabular-nums ${restante === 0 ? "text-success-700" : "text-danger-600"}`}>
          {restante === 0 ? "Pagamento completo" : restante > 0 ? `Falta ${formatarCentavos(restante)}` : `Excede ${formatarCentavos(-restante)}`}
        </span>
      </div>
    </div>
  );
}
