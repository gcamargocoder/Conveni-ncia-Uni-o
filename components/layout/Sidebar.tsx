"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  ShoppingCart,
  Boxes,
  Receipt,
  Tags,
  Truck,
  Users,
  Contact2,
  LayoutDashboard,
  FileBarChart2,
  History,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  X,
  type LucideIcon,
} from "lucide-react";

interface ItemMenu {
  href: string;
  titulo: string;
  icone: LucideIcon;
}

interface GrupoMenu {
  rotulo: string;
  itens: ItemMenu[];
}

const GRUPOS: GrupoMenu[] = [
  {
    rotulo: "Operação diária",
    itens: [
      { href: "/pdv", titulo: "Venda", icone: ShoppingCart },
      { href: "/estoque", titulo: "Estoque", icone: Boxes },
      { href: "/contas-receber", titulo: "Contas a Receber", icone: Receipt },
    ],
  },
  {
    rotulo: "Cadastros",
    itens: [
      { href: "/produtos", titulo: "Produtos", icone: Tags },
      { href: "/fornecedores", titulo: "Fornecedores", icone: Truck },
      { href: "/funcionarios", titulo: "Funcionários", icone: Users },
      { href: "/clientes", titulo: "Clientes", icone: Contact2 },
    ],
  },
  {
    rotulo: "Análise",
    itens: [
      { href: "/dashboard", titulo: "Dashboard", icone: LayoutDashboard },
      { href: "/relatorios", titulo: "Relatórios", icone: FileBarChart2 },
      { href: "/historico", titulo: "Histórico", icone: History },
      { href: "/sincronizacao", titulo: "Sincronização", icone: RefreshCw },
    ],
  },
];

interface SidebarProps {
  colapsada: boolean;
  onToggleColapsar: () => void;
  abertaMobile: boolean;
  onFecharMobile: () => void;
}

export function Sidebar({ colapsada, onToggleColapsar, abertaMobile, onFecharMobile }: SidebarProps) {
  const pathname = usePathname();

  return (
    <>
      {abertaMobile && (
        <div
          className="fixed inset-0 bg-slate-900/40 z-40 md:hidden animate-fade-in"
          onClick={onFecharMobile}
          aria-hidden="true"
        />
      )}

      <aside
        className={`
          fixed md:static inset-y-0 left-0 z-50 md:z-0
          flex flex-col bg-white border-r border-slate-200 w-64
          transition-transform duration-200 md:transition-[width]
          ${abertaMobile ? "translate-x-0" : "-translate-x-full"} md:translate-x-0
          ${colapsada ? "md:w-[72px]" : "md:w-64"}
        `}
      >
        <div className="flex items-center gap-2 h-16 px-4 border-b border-slate-100 shrink-0">
          <Link href="/pdv" className="flex items-center gap-3 min-w-0 flex-1">
            <Image
              src="/logo-auto-posto-uniao.jpeg"
              alt="Auto Posto União"
              width={32}
              height={32}
              className="rounded-md shrink-0"
            />
            {!colapsada && <span className="font-semibold text-sm text-slate-900 truncate">Auto Posto União</span>}
          </Link>

          <button
            onClick={onToggleColapsar}
            aria-label={colapsada ? "Expandir menu" : "Retrair menu"}
            className="hidden md:flex items-center justify-center w-7 h-7 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-50 shrink-0 transition-colors"
          >
            {colapsada ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>

          <button
            onClick={onFecharMobile}
            aria-label="Fechar menu"
            className="md:hidden text-slate-400 shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-4 px-3 flex flex-col gap-5">
          {GRUPOS.map((grupo) => (
            <div key={grupo.rotulo}>
              {!colapsada && (
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 px-3 mb-1.5">
                  {grupo.rotulo}
                </p>
              )}
              <div className="flex flex-col gap-0.5">
                {grupo.itens.map((item) => {
                  const Icone = item.icone;
                  const ativo = pathname?.startsWith(item.href) ?? false;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={onFecharMobile}
                      title={colapsada ? item.titulo : undefined}
                      className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                        ativo
                          ? "bg-brand-50 text-brand-700 font-semibold"
                          : "text-slate-600 font-medium hover:bg-slate-50 hover:text-slate-900"
                      }`}
                    >
                      {ativo && (
                        <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-brand-700" />
                      )}
                      <Icone
                        className={`w-4 h-4 shrink-0 transition-colors ${
                          ativo ? "text-brand-700" : "text-slate-400 group-hover:text-slate-600"
                        }`}
                      />
                      {!colapsada && item.titulo}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div
          title="Desenvolvido por GC-Sys"
          className="flex items-center gap-2 h-14 px-4 border-t border-slate-100 shrink-0 text-slate-400"
        >
          <img src="/logos/gc-sys-icone-96.png" alt="GC-Sys" className="w-8 h-8 rounded shrink-0" />
          {!colapsada && <span className="text-xs truncate">Desenvolvido por GC-Sys</span>}
        </div>
      </aside>
    </>
  );
}