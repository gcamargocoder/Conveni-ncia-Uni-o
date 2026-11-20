import { formatarCentavos } from "@/lib/caixa/calculo";
import { ROTULO_FORMA, type DiferencaForma, type FormaCaixa, type ResumoCaixa } from "@/lib/caixa/tipos";

const FORMAS_CONFERIDAS: FormaCaixa[] = ["pix", "credito", "debito"];

function Linha({ rotulo, valor, destaque, negativo }: { rotulo: string; valor: number; destaque?: boolean; negativo?: boolean }) {
  return (
    <div
      className={`flex items-baseline justify-between gap-3 py-1.5 ${
        destaque ? "border-t border-slate-200 mt-1 pt-2.5 font-semibold text-slate-900" : "text-slate-600"
      }`}
    >
      <span className="text-sm">{rotulo}</span>
      <span className={`tabular-nums whitespace-nowrap shrink-0 ${negativo && valor !== 0 ? "text-danger-600" : ""}`}>{formatarCentavos(valor)}</span>
    </div>
  );
}

/**
 * Resumo do caixa por forma de pagamento. Mantém SEPARADOS: faturamento (vendas), recebimentos, saldo físico
 * de dinheiro e valor líquido previsto de operadoras de cartão (grandezas diferentes, nunca somadas entre si).
 */
export function ResumoCaixaView({ resumo, diferencas }: { resumo: ResumoCaixa; diferencas?: DiferencaForma[] }) {
  const d = resumo.dinheiro;
  const dif = (forma: string) => (Array.isArray(diferencas) ? diferencas : undefined)?.find((x) => x.forma === forma);
  const difDinheiro = dif("dinheiro");

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <section className="rounded-xl border border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-800 mb-2">Dinheiro (gaveta)</h3>
        <Linha rotulo="Fundo inicial (troco)" valor={d.fundo_inicial_centavos} />
        <Linha rotulo="Vendas em dinheiro" valor={d.entradas_vendas_centavos} />
        {d.recebimentos_conta_centavos !== 0 && <Linha rotulo="Recebimentos de contas" valor={d.recebimentos_conta_centavos} />}
        <Linha rotulo="Suprimentos" valor={d.suprimentos_centavos} />
        {d.outras_entradas_centavos !== 0 && <Linha rotulo="Outras entradas / ajustes" valor={d.outras_entradas_centavos} />}
        <Linha rotulo="Sangrias" valor={-d.sangrias_centavos} />
        <Linha rotulo="Despesas pagas pelo caixa" valor={-d.despesas_centavos} />
        {d.outras_saidas_centavos !== 0 && <Linha rotulo="Outras retiradas / ajustes" valor={-d.outras_saidas_centavos} />}
        {d.estornos_centavos !== 0 && <Linha rotulo="Estornos (efeito líquido)" valor={d.estornos_centavos} />}
        <Linha rotulo="Saldo esperado em dinheiro" valor={d.saldo_esperado_centavos} destaque />
        {difDinheiro?.informado_centavos != null && (
          <>
            <Linha rotulo="Valor contado" valor={difDinheiro.informado_centavos} />
            <Linha rotulo="Diferença" valor={difDinheiro.diferenca_centavos ?? 0} negativo />
          </>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-800 mb-2">Totais</h3>
        <Linha rotulo={`Total de vendas (${resumo.quantidade_vendas}) — faturamento, inclui fiado`} valor={resumo.total_vendas_centavos} />
        <Linha rotulo="Total efetivamente recebido (sem fiado)" valor={resumo.total_recebido_centavos} />
        <Linha rotulo="Total de entradas" valor={resumo.total_entradas_centavos} />
        <Linha rotulo="Total de saídas" valor={resumo.total_saidas_centavos} />
        <p className="text-xs text-slate-500 mt-2">
          Faturamento, recebimentos, saldo físico de dinheiro e valor líquido de operadoras são grandezas diferentes e não se somam.
        </p>
      </section>

      {FORMAS_CONFERIDAS.map((forma) => {
        const l = resumo.por_forma[forma];
        const cartao = forma === "credito" || forma === "debito";
        const x = dif(forma);
        return (
          <section key={forma} className="rounded-xl border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-800 mb-2">{ROTULO_FORMA[forma]}</h3>
            <Linha rotulo={`Total ${cartao ? "bruto" : "registrado"} (${l.quantidade} transação(ões))`} valor={l.saldo_centavos} />
            {cartao && (
              <>
                <Linha rotulo="Taxas conhecidas da operadora" valor={l.taxas_conhecidas_centavos} />
                <Linha rotulo="Líquido previsto (bruto − taxas conhecidas)" valor={l.liquido_previsto_centavos} />
                {l.operacoes_sem_taxa > 0 && (
                  <p className="text-xs text-warning-700">
                    {l.operacoes_sem_taxa} operação(ões) sem taxa informada: o líquido real pode ser menor.
                  </p>
                )}
              </>
            )}
            {x?.informado_centavos != null && (
              <>
                <Linha rotulo="Total informado na conferência" valor={x.informado_centavos} />
                <Linha rotulo="Diferença" valor={x.diferenca_centavos ?? 0} negativo />
              </>
            )}
          </section>
        );
      })}

      <section className="rounded-xl border border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-800 mb-2">{ROTULO_FORMA.fiado}</h3>
        <Linha rotulo={`Vendas a prazo (${resumo.por_forma.fiado.quantidade})`} valor={resumo.por_forma.fiado.saldo_centavos} />
        <p className="text-xs text-slate-500 mt-2">
          Fiado não é dinheiro recebido: só entra no caixa quando o recebimento da conta for registrado.
        </p>
      </section>
    </div>
  );
}
