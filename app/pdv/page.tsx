import { PDVClient } from "@/components/pdv/PDVClient";

// Nada para buscar aqui: o catálogo não é mais carregado inteiro.
// A busca de produtos acontece sob demanda, dentro do PDVClient.
export default function PDVPage() {
  return <PDVClient />;
}
