export interface ErroValidacaoCliente {
  campo: string;
  mensagem: string;
}

export interface DadosCliente {
  nome: string;
  telefone?: string | null;
  cpf?: string | null;
  endereco?: string | null;
  observacoes?: string | null;
  ativo?: boolean;
}

export function validarCliente(dados: DadosCliente): ErroValidacaoCliente[] {
  const erros: ErroValidacaoCliente[] = [];

  if (!dados.nome || dados.nome.trim().length < 2) {
    erros.push({ campo: "nome", mensagem: "Nome deve ter pelo menos 2 caracteres." });
  }

  if (dados.cpf && dados.cpf.trim()) {
    const digitos = dados.cpf.replace(/\D/g, "");
    if (digitos.length !== 11) {
      erros.push({ campo: "cpf", mensagem: "CPF deve ter 11 dígitos." });
    }
  }

  if (dados.telefone && dados.telefone.trim()) {
    const digitos = dados.telefone.replace(/\D/g, "");
    if (digitos.length < 10 || digitos.length > 11) {
      erros.push({ campo: "telefone", mensagem: "Telefone deve ter 10 ou 11 dígitos (com DDD)." });
    }
  }

  return erros;
}