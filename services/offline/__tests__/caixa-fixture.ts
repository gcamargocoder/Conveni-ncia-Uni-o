import { getOfflineDB } from "../db";
import { abrirCaixaLocal, marcarAberturaSincronizada } from "../caixa-local.service";

/**
 * Fixture dos testes de PDV offline: vender exige caixa aberto. Limpa as tabelas de caixa e abre um
 * caixa novo (fundo de R$ 100,00) para o terminal atual, já com a abertura SINCRONIZADA (fora da fila),
 * para que os testes de venda/fila não enxerguem a operação de abertura. Chamar DEPOIS de limpar
 * configuracoes_local.
 */
export async function prepararCaixaDeTeste(fundoCentavos = 10000) {
  const db = getOfflineDB();
  await Promise.all([db.caixas_locais.clear(), db.movimentos_caixa_locais.clear()]);
  const caixa = await abrirCaixaLocal({ fundoInicialCentavos: fundoCentavos, responsavel: { id: "f-abertura", nome: "Abertura" } });
  await db.fila_sincronizacao.delete(caixa.id);
  await marcarAberturaSincronizada(caixa.id);
  return caixa;
}
