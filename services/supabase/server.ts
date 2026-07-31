import { createClient } from "@supabase/supabase-js";

/**
 * Cliente Supabase usado por TODO acesso a dados deste sistema
 * (Server Actions e Server Components — nunca o navegador).
 *
 * Usa a service_role key, não a anon key. Motivo: com RLS habilitado
 * (migration 0010) e nenhuma policy pública, a anon key não acessa
 * nada — de propósito, para que o navegador nunca consiga falar com
 * o banco diretamente. A service_role ignora RLS e só deve existir
 * aqui, no servidor. NUNCA prefixe essa variável com NEXT_PUBLIC_.
 */
export async function createSupabaseServerClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}
