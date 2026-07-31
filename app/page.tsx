import { redirect } from "next/navigation";

// PDV é a página principal do sistema — é onde se trabalha o dia
// inteiro. O menu lateral (Sidebar) já dá acesso a todas as outras
// telas, então não faz mais sentido ter uma home separada listando
// os mesmos links.
export default function HomePage() {
  redirect("/pdv");
}