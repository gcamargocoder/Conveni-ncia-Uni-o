export const MAX_TENTATIVAS = 5;
export const MINUTOS_BLOQUEIO = 15;

export interface EstadoTentativas {
  tentativas_falhas: number;
  bloqueado_ate: string | null;
}

export function estaBloqueado(estado: EstadoTentativas | null): boolean {
  if (!estado?.bloqueado_ate) return false;
  return new Date(estado.bloqueado_ate).getTime() > Date.now();
}

export function deveBloquear(tentativasFalhasAtuais: number): boolean {
  return tentativasFalhasAtuais + 1 >= MAX_TENTATIVAS;
}

export function calcularBloqueioAte(): string {
  const data = new Date();
  data.setMinutes(data.getMinutes() + MINUTOS_BLOQUEIO);
  return data.toISOString();
}
