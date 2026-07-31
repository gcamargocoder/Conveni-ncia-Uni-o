export interface ErroValidacaoProduto {
  campo: string;
  mensagem: string;
}

export interface DadosProduto {
  nome: string;
  categoria_id: string;
  preco_venda: number;
  preco_custo: number;
  estoque_minimo: number;
  codigo_barras?: string | null;
}

/**
 * Validações que não dependem de banco de dados nem de UI.
 * Roda igual no navegador (feedback rápido) e no servidor
 * (garantia real, já que o navegador pode ser burlado).
 */
export function validarProduto(dados: DadosProduto): ErroValidacaoProduto[] {
  const erros: ErroValidacaoProduto[] = [];

  if (!dados.nome || dados.nome.trim().length < 2) {
    erros.push({ campo: "nome", mensagem: "Nome deve ter pelo menos 2 caracteres." });
  }

  if (!dados.categoria_id) {
    erros.push({ campo: "categoria_id", mensagem: "Selecione uma categoria." });
  }

  if (dados.preco_venda <= 0) {
    erros.push({ campo: "preco_venda", mensagem: "Preço de venda deve ser maior que zero." });
  }

  if (dados.preco_custo < 0) {
    erros.push({ campo: "preco_custo", mensagem: "Preço de custo não pode ser negativo." });
  }

  if (dados.estoque_minimo < 0) {
    erros.push({ campo: "estoque_minimo", mensagem: "Estoque mínimo não pode ser negativo." });
  }

  if (dados.codigo_barras && dados.codigo_barras.length > 0 && dados.codigo_barras.length < 8) {
    erros.push({ campo: "codigo_barras", mensagem: "Código de barras muito curto." });
  }

  return erros;
}

/**
 * Não é um erro bloqueante — é um alerta. A tela decide se pede
 * confirmação extra ("tem certeza?") quando isso for true.
 */
export function precoVendaAbaixoDoCusto(dados: DadosProduto): boolean {
  return dados.preco_venda < dados.preco_custo;
}

export function calcularMargemPercentual(precoVenda: number, precoCusto: number): number {
  if (precoCusto === 0) return 0;
  return ((precoVenda - precoCusto) / precoCusto) * 100;
}
