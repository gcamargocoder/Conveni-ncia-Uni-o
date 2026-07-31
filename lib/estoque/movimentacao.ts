import { TipoMovimentacao } from "@/types/estoque";
import { Permissao } from "@/lib/auth/permissoes";

export interface ErroValidacaoMovimentacao {
  campo: string;
  mensagem: string;
}

export interface DadosMovimentacao {
  produto_id: string;
  tipo: TipoMovimentacao;
  quantidade: number;
  funcionario_id: string;
  observacao?: string | null;
  dispositivo?: string;
}

// Tipos que uma tela de "entrada manual" pode registrar.
// 'venda' nunca é escolhida manualmente — nasce automática do PDV (trigger no banco).
export const TIPOS_ENTRADA_MANUAL: TipoMovimentacao[] = [
  "entrada",
  "perda",
  "ajuste_entrada",
  "ajuste_saida",
  "inventario",
  "consumo_interno",
];

export function validarMovimentacao(dados: DadosMovimentacao): ErroValidacaoMovimentacao[] {
  const erros: ErroValidacaoMovimentacao[] = [];

  if (!dados.produto_id) {
    erros.push({ campo: "produto_id", mensagem: "Selecione um produto." });
  }

  if (!dados.funcionario_id) {
    erros.push({ campo: "funcionario_id", mensagem: "Operação precisa de um responsável (PIN)." });
  }

  if (dados.quantidade <= 0) {
    erros.push({ campo: "quantidade", mensagem: "Quantidade deve ser maior que zero." });
  }

  if (dados.tipo === "venda") {
    erros.push({
      campo: "tipo",
      mensagem: "Movimentação de venda é gerada automaticamente, não pode ser lançada manualmente.",
    });
  }

  return erros;
}

/**
 * Alguns tipos exigem justificativa por escrito — são os que mais
 * geram dúvida depois ("por que faltou estoque?"). A tela usa isso
 * para tornar o campo de observação obrigatório só quando faz sentido.
 */
export function exigeObservacao(tipo: TipoMovimentacao): boolean {
  return tipo === "perda" || tipo === "ajuste_saida" || tipo === "consumo_interno";
}

/**
 * Antes esse mapeamento vivia como um ternário dentro da Server Action
 * (lib/estoque/actions.ts), tratando "entrada" como caso especial e
 * empilhando perda/ajuste/inventário/consumo sob a mesma permissão
 * de forma implícita. Movido para cá — é regra de negócio, não
 * responsabilidade da action — e explícito por tipo, para ficar
 * claro (e fácil de mudar no futuro) qual operação exige o quê.
 */
export function permissaoNecessaria(tipo: TipoMovimentacao): Permissao {
  if (tipo === "entrada") return "estoque.entrada";
  return "estoque.ajuste";
}
