/**
 * Busca por nome usada nas listas (Estoque, Produtos): sem diferença de maiúsculas/minúsculas nem de acentos.
 * "agua", "ÁGUA" e "Água" encontram "Água 500ml". Só compara texto já carregado na tela; não toca no banco.
 */
export function normalizarBusca(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/\s+/g, " ")
    .trim();
}

/** Busca vazia (ou só espaços) corresponde a tudo. */
export function correspondeBusca(nome: string, busca: string): boolean {
  const termo = normalizarBusca(busca);
  return termo === "" || normalizarBusca(nome).includes(termo);
}
