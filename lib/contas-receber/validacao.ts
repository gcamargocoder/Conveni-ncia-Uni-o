export interface DadosFormPagamento {
  valor: number;
  formaPagamento: string;
  observacoes?: string;
}

export interface ErroValidacaoPagamento {
  campo: string;
  mensagem: string;
}

export function validarPagamento(dados: DadosFormPagamento, saldoAtual: number): ErroValidacaoPagamento[] {
  const erros: ErroValidacaoPagamento[] = [];

  if (!dados.valor || dados.valor <= 0) {
    erros.push({ campo: "valor", mensagem: "Valor deve ser maior que zero." });
  } else if (dados.valor > saldoAtual) {
    erros.push({
      campo: "valor",
      mensagem: `Valor não pode ser maior que o saldo devedor (R$ ${saldoAtual.toFixed(2)}).`,
    });
  }

  if (!dados.formaPagamento) {
    erros.push({ campo: "formaPagamento", mensagem: "Selecione a forma de pagamento." });
  }

  return erros;
}