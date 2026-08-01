export interface ErroValidacaoFornecedor {
  campo: string;
  mensagem: string;
}

export interface DadosFornecedor {
  nome: string;
  razao_social?: string | null;
  cnpj_cpf?: string | null;
  telefone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  endereco?: string | null;
  cidade?: string | null;
  estado?: string | null;
  observacoes?: string | null;
  ativo?: boolean;
}

function cnpjValido(valor: string): boolean {
  const digitos = valor.replace(/\D/g, "");
  if (digitos.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(digitos)) return false;

  function calcularDigito(base: string, pesos: number[]): number {
    const soma = base.split("").reduce((acc, d, i) => acc + Number(d) * pesos[i], 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  }

  const pesos1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const pesos2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

  const d1 = calcularDigito(digitos.slice(0, 12), pesos1);
  const d2 = calcularDigito(digitos.slice(0, 12) + d1, pesos2);

  return digitos === digitos.slice(0, 12) + String(d1) + String(d2);
}

function cpfValido(valor: string): boolean {
  const digitos = valor.replace(/\D/g, "");
  if (digitos.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(digitos)) return false;

  function calcularDigito(base: string, pesoInicial: number): number {
    let soma = 0;
    for (let i = 0; i < base.length; i++) soma += Number(base[i]) * (pesoInicial - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  }

  const d1 = calcularDigito(digitos.slice(0, 9), 10);
  const d2 = calcularDigito(digitos.slice(0, 9) + d1, 11);

  return digitos === digitos.slice(0, 9) + String(d1) + String(d2);
}

const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validarFornecedor(dados: DadosFornecedor): ErroValidacaoFornecedor[] {
  const erros: ErroValidacaoFornecedor[] = [];

  if (!dados.nome || dados.nome.trim().length < 2) {
    erros.push({ campo: "nome", mensagem: "Nome deve ter pelo menos 2 caracteres." });
  }

  if (dados.cnpj_cpf && dados.cnpj_cpf.trim()) {
    const digitos = dados.cnpj_cpf.replace(/\D/g, "");
    const valido = digitos.length === 14 ? cnpjValido(digitos) : digitos.length === 11 ? cpfValido(digitos) : false;
    if (!valido) {
      erros.push({ campo: "cnpj_cpf", mensagem: "CNPJ ou CPF inválido." });
    }
  }

  if (dados.telefone && dados.telefone.trim()) {
    const digitos = dados.telefone.replace(/\D/g, "");
    if (digitos.length < 10 || digitos.length > 11) {
      erros.push({ campo: "telefone", mensagem: "Telefone deve ter 10 ou 11 dígitos (com DDD)." });
    }
  }

  if (dados.whatsapp && dados.whatsapp.trim()) {
    const digitos = dados.whatsapp.replace(/\D/g, "");
    if (digitos.length < 10 || digitos.length > 11) {
      erros.push({ campo: "whatsapp", mensagem: "WhatsApp deve ter 10 ou 11 dígitos (com DDD)." });
    }
  }

  if (dados.email && dados.email.trim() && !REGEX_EMAIL.test(dados.email.trim())) {
    erros.push({ campo: "email", mensagem: "E-mail inválido." });
  }

  return erros;
}