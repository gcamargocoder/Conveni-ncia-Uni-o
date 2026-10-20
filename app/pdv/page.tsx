import { PDVClient } from "@/components/pdv/PDVClient";
import { exigirSessao } from "@/lib/auth/servidor";

// Nada para buscar aqui: o catálogo não é mais carregado inteiro.
// A busca de produtos acontece sob demanda, dentro do PDVClient.
export default async function PDVPage() {
  await exigirSessao();
  return <PDVClient />;
}
