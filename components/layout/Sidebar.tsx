"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useSessao } from "@/components/auth/SessaoProvider";
import { BotaoSair } from "@/components/auth/BotaoSair";
import { IndicadorRevisao } from "@/components/vendas/IndicadorRevisao";
import {
  ShoppingCart,
  Boxes,
  Receipt,
  Tags,
  Layers,
  Truck,
  Users,
  Contact2,
  LayoutDashboard,
  FileBarChart2,
  History,
  RefreshCw,
  DatabaseBackup,
  UserCog,
  ClipboardCheck,
  ChevronLeft,
  ChevronRight,
  X,
  type LucideIcon,
} from "lucide-react";

interface ItemMenu {
  href: string;
  titulo: string;
  icone: LucideIcon;
  somenteAdmin?: boolean;
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
      { href: "/categorias", titulo: "Categorias", icone: Layers },
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
      { href: "/backup", titulo: "Backup", icone: DatabaseBackup, somenteAdmin: true },
    ],
  },
  {
    rotulo: "Administração",
    itens: [
      { href: "/vendas-revisao", titulo: "Vendas em revisão", icone: ClipboardCheck, somenteAdmin: true },
      { href: "/usuarios", titulo: "Usuários", icone: UserCog, somenteAdmin: true },
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
  const { usuario } = useSessao();
  const ehAdmin = usuario?.papel === "admin";

  const grupos = GRUPOS.map((g) => ({ ...g, itens: g.itens.filter((i) => !i.somenteAdmin || ehAdmin) })).filter(
    (g) => g.itens.length > 0
  );

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
          flex flex-col bg-surface border-r border-surface-border w-64
          transition-transform duration-200 md:transition-[width]
          ${abertaMobile ? "translate-x-0" : "-translate-x-full"} md:translate-x-0
          ${colapsada ? "md:w-[72px]" : "md:w-64"}
        `}
      >
        <div className="flex items-center gap-2 h-16 px-4 border-b border-surface-border shrink-0">
          <Link href="/pdv" className="flex items-center gap-3 min-w-0 flex-1">
            <Image
              src="/logo-auto-posto-uniao.jpeg"
              alt="Auto Posto União"
              width={32}
              height={32}
              className="rounded-md shrink-0"
            />
            {!colapsada && <span className="font-semibold text-sm text-white truncate">Auto Posto União</span>}
          </Link>

          <button
            onClick={onToggleColapsar}
            aria-label={colapsada ? "Expandir menu" : "Retrair menu"}
            className="hidden md:flex items-center justify-center w-7 h-7 rounded-md text-zinc-500 hover:text-white hover:bg-zinc-800/30 shrink-0 transition-colors duration-150"
          >
            {colapsada ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>

          <button
            onClick={onFecharMobile}
            aria-label="Fechar menu"
            className="md:hidden text-zinc-400 hover:text-white shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-4 px-3 flex flex-col gap-5">
          {grupos.map((grupo) => (
            <div key={grupo.rotulo}>
              {!colapsada && (
                <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 px-3 mb-1.5">
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
                      className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors duration-150 ${ativo
                          ? "bg-zinc-800/50 text-white font-semibold"
                          : "text-zinc-400 font-medium hover:bg-zinc-800/30 hover:text-white"
                        }`}
                    >
                      {ativo && (
                        <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-brand-blue" />
                      )}
                      <Icone
                        className={`w-4 h-4 shrink-0 transition-colors duration-150 ${ativo ? "text-brand-blue" : "text-zinc-500 group-hover:text-white"
                          }`}
                      />
                      {!colapsada && item.titulo}
                      {item.href === "/vendas-revisao" && <IndicadorRevisao colapsada={colapsada} />}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {usuario && (
          <div className="flex items-center gap-2 px-3 py-3 border-t border-surface-border shrink-0">
            {!colapsada && (
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-white truncate">{usuario.nome}</p>
                <p className="text-xs text-zinc-500 truncate">{ehAdmin ? "Administrador" : "Operador"}</p>
              </div>
            )}
            <BotaoSair colapsada={colapsada} />
          </div>
        )}

        <a
          href="https://gc-sys.vercel.app/"
          target="_blank"
          rel="noopener noreferrer"
          title="Desenvolvido por GC-Sys"
          className="flex items-center gap-2 h-14 px-4 border-t border-surface-border shrink-0 text-zinc-500 hover:text-zinc-300 transition-colors duration-150"
        >
          {!colapsada && <span className="text-xs shrink-0">Desenvolvido por</span>}
          <img src="/logos/gc-sys-logo-horizontal.png" alt="GC-Sys" className="h-6 w-auto shrink-0" />
        </a>
      </aside>
    </>
  );
}