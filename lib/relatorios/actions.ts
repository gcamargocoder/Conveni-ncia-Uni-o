"use server";

import { verificarAcesso } from "@/lib/auth/servidor";
import { janelaDoFiltro, lerFiltroVendas, type ParametrosBrutos } from "@/lib/relatorios/filtro";
import { montarPlanilhas, rotuloTerminal } from "@/lib/relatorios/planilha-vendas";
import { gerarXlsx } from "@/lib/relatorios/xlsx";
import { LIMITE_EXPORTACAO, listarVendasDetalhadas } from "@/services/relatorios.service";
import { listarCaixas, listarTerminais } from "@/services/caixa-consulta.service";
import { listarFuncionarios } from "@/services/funcionarios.service";

export type ResultadoExportacao =
  | { sucesso: true; nome: string; base64: string; truncado: boolean }
  | { sucesso: false; erro: string };

/**
 * Exporta para Excel EXATAMENTE o que a tela de relatórios mostra: a tela e a exportação recebem os mesmos
 * parâmetros de URL, passam pelo mesmo `lerFiltroVendas` e pela mesma consulta `listarVendasDetalhadas`.
 * O fechamento de turno só vai para quem é administrador (mesma regra do histórico de caixa).
 *
 * É Server Action (e não route handler) porque o projeto só aceita acesso a dados por Server Actions com guard
 * (teste `cobertura-rotas`); o arquivo vai como base64 e o navegador o baixa.
 */
export async function exportarRelatorioVendasAction(parametros: ParametrosBrutos): Promise<ResultadoExportacao> {
  const acesso = await verificarAcesso("usuario");
  if (!acesso.ok) return { sucesso: false, erro: acesso.erro };

  try {
    const { filtro } = lerFiltroVendas(parametros ?? {});
    const admin = acesso.sessao.usuario.papel === "admin";
    const { inicio, fim } = janelaDoFiltro(filtro);

    const [{ vendas, truncado }, funcionarios, terminais, caixas] = await Promise.all([
      listarVendasDetalhadas(filtro, LIMITE_EXPORTACAO),
      listarFuncionarios(),
      listarTerminais(),
      admin
        ? listarCaixas(
            filtro.caixa_id
              ? { ids: [filtro.caixa_id] }
              : {
                  inicio: inicio.toISOString(),
                  fim: new Date(fim.getTime() - 1).toISOString(),
                  terminal_id: filtro.terminal_id,
                  funcionario_id: filtro.funcionario_id,
                }
          )
        : Promise.resolve([]),
    ]);

    const terminal = terminais.find((t) => t.terminal_id === filtro.terminal_id);
    const planilha = gerarXlsx(
      montarPlanilhas({
        filtro,
        vendas,
        caixas,
        geradoEm: new Date(),
        truncado,
        rotulos: {
          funcionario: funcionarios.find((f) => f.id === filtro.funcionario_id)?.nome ?? null,
          terminal: terminal ? rotuloTerminal(terminal.terminal_id, terminal.terminal_papel) : filtro.terminal_id,
          turno: filtro.caixa_id ? filtro.caixa_id.slice(0, 8) : null,
        },
      })
    );

    const nome = `relatorio-vendas-${filtro.dataInicial}${filtro.dataFinal !== filtro.dataInicial ? `_a_${filtro.dataFinal}` : ""}.xlsx`;
    return { sucesso: true, nome, base64: planilha.toString("base64"), truncado };
  } catch (e) {
    console.error(`[relatorios] falha ao exportar: ${(e as Error).message}`);
    return { sucesso: false, erro: "Não foi possível gerar a planilha." };
  }
}
