export type NivelUrgencia = "verde" | "amarelo" | "vermelho";

export interface ClassificacaoUrgencia {
  nivel: NivelUrgencia;
  rotulo: string;
  variante: "success" | "warning" | "danger";
}

export function classificarUrgencia(diasEmAberto: number): ClassificacaoUrgencia {
  if (diasEmAberto > 30) {
    return { nivel: "vermelho", rotulo: `${diasEmAberto} dia(s)`, variante: "danger" };
  }
  if (diasEmAberto >= 16) {
    return { nivel: "amarelo", rotulo: `${diasEmAberto} dia(s)`, variante: "warning" };
  }
  return { nivel: "verde", rotulo: `${diasEmAberto} dia(s)`, variante: "success" };
}