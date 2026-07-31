/**
 * Campos que TODA entidade do sistema possui.
 *
 * Por quê:
 * - `id` é UUID (não incremental) para que, no futuro, dois dispositivos
 *   offline nunca gerem o mesmo identificador.
 * - `created_at` / `updated_at` / `deleted_at` existem desde o início:
 *   não custam nada agora e evitam retrabalho quando entrarmos na fase
 *   Offline First (sincronização e auditoria dependem deles).
 * - Nunca apagamos um registro de verdade (soft delete via `deleted_at`),
 *   conforme o princípio de nunca perder histórico.
 */
export interface BaseEntity {
  id: string; // UUID v4
  created_at: string; // ISO 8601
  updated_at: string; // ISO 8601
  deleted_at: string | null;
}
