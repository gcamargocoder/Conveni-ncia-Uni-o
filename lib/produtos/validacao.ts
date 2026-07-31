export interface ErroValidacaoProduto {
  campo: string;
  mensagem: string;
}

/**
 * Valor padrão de estoque mínimo para todo produto novo — o cliente
 * pediu para não perguntar isso no cadastro (causava confusão real:
 * a pessoa lia "Estoque mínimo: 20" e achava que já tinha 20 unidades
 * disponíveis, quando na verdade era só o limiar do alerta). Continua
 * ajustável depois, por produto, na tela de Estoque.
 */
export const PADRAO_ESTOQUE_MINIMO = 10;

export interface DadosProduto {
  nome: string;
  categoria_id: string;
  preco_venda: number;
  preco_custo: number;
  estoque_minimo: number;
  codigo_barras?: string | null;
}

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

export function precoVendaAbaixoDoCusto(dados: DadosProduto): boolean {
  return dados.preco_venda < dados.preco_custo;
}

export function calcularMargemPercentual(precoVenda: number, precoCusto: number): number {
  if (precoCusto === 0) return 0;
  return ((precoVenda - precoCusto) / precoCusto) * 100;
}