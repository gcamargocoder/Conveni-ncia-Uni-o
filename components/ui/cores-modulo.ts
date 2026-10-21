/**
 * DNA de cores por módulo — a mesma cor do ícone na Sidebar acompanha o
 * módulo em cabeçalhos, tabelas, estados vazios e modais. As classes são
 * literais (e este arquivo está sob `components/`) para o JIT do Tailwind
 * conseguir gerá-las.
 */
export type ModuloCor =
  | "dashboard"
  | "pdv"
  | "estoque"
  | "contasReceber"
  | "produtos"
  | "categorias"
  | "fornecedores"
  | "funcionarios"
  | "clientes"
  | "relatorios"
  | "historico"
  | "sincronizacao"
  | "backup"
  | "revisao"
  | "usuarios";

export const COR_ICONE_MODULO: Record<ModuloCor, string> = {
  dashboard: "text-sky-500",
  pdv: "text-teal-500",
  estoque: "text-emerald-500",
  contasReceber: "text-amber-500",
  produtos: "text-orange-500",
  categorias: "text-violet-500",
  fornecedores: "text-cyan-500",
  funcionarios: "text-pink-500",
  clientes: "text-fuchsia-500",
  relatorios: "text-purple-500",
  historico: "text-indigo-500",
  sincronizacao: "text-brand-600",
  backup: "text-lime-500",
  revisao: "text-rose-500",
  usuarios: "text-violet-500",
};

/** Fundo suave do círculo/quadrado que abriga o ícone do módulo. */
export const COR_FUNDO_MODULO: Record<ModuloCor, string> = {
  dashboard: "bg-sky-50",
  pdv: "bg-teal-50",
  estoque: "bg-emerald-50",
  contasReceber: "bg-amber-50",
  produtos: "bg-orange-50",
  categorias: "bg-violet-50",
  fornecedores: "bg-cyan-50",
  funcionarios: "bg-pink-50",
  clientes: "bg-fuchsia-50",
  relatorios: "bg-purple-50",
  historico: "bg-indigo-50",
  sincronizacao: "bg-brand-50",
  backup: "bg-lime-50",
  revisao: "bg-rose-50",
  usuarios: "bg-violet-50",
};

/** Cores dos meios de pagamento no PDV. */
export const COR_ICONE_PAGAMENTO = {
  dinheiro: "text-emerald-500",
  pix: "text-teal-500",
  debito: "text-violet-500",
  credito: "text-amber-500",
  fiado: "text-rose-500",
} as const;
