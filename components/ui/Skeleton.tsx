import { HTMLAttributes } from "react";

/**
 * Placeholder de carregamento — evita telas em branco enquanto dados
 * assíncronos chegam (Server Components aguardando o Supabase, ou
 * buscas locais no IndexedDB). Largura/altura controladas via className,
 * ex: <Skeleton className="h-6 w-32" />.
 */
export function Skeleton({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`animate-pulse rounded-md bg-slate-200 ${className}`} {...props} />;
}