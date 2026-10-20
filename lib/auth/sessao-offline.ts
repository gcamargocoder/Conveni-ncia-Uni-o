import { OFFLINE_MAXIMO_MS } from "@/lib/auth/constantes";

/**
 * Política de uso OFFLINE de um dispositivo já autenticado (lado cliente).
 *
 * O servidor continua sendo a única autoridade: cada venda guardada offline só
 * vale depois que a fila sincroniza com uma sessão válida. Este marcador existe
 * apenas para decidir, SEM internet, se a tela do PDV pode continuar sendo
 * usada. Ele contém dados não secretos (nome, horários) — nunca senha, token
 * de sessão nem hash.
 *
 * Regras:
 *  - A sessão é revalidada no servidor sempre que há conexão; cada validação
 *    bem-sucedida renova `ultimaValidacaoEm`.
 *  - Sem conexão, o PDV segue liberado por até OFFLINE_MAXIMO_MS (padrão 72 h)
 *    desde a última validação, e nunca além do teto absoluto da sessão.
 *  - Se o servidor responder "não autenticado" (sessão expirada, revogada ou
 *    usuário desativado), o acesso é encerrado imediatamente, mesmo que o
 *    prazo offline ainda não tenha vencido.
 *  - Sem marcador (logout, dados do navegador apagados), não há acesso offline.
 */

export const CHAVE_MARCADOR = "sessao_offline_v1";
export const CHAVE_LOGOUT_PENDENTE = "logout_pendente_v1";

export interface MarcadorSessao {
  usuarioId: string;
  nome: string;
  /** Só para a interface offline (menu); o servidor sempre decide as permissões. Ausente em marcadores antigos. */
  papel?: "admin" | "operador";
  ultimaValidacaoEm: number;
  expiraAbsolutaEm: number;
}

export type RespostaServidor = "autenticado" | "nao_autenticado" | "indisponivel";
export type EstadoAcesso = "liberado" | "bloqueado_offline" | "sessao_encerrada";

export function decidirAcesso(
  marcador: MarcadorSessao | null,
  servidor: RespostaServidor,
  agora: number,
  maximoOfflineMs: number = OFFLINE_MAXIMO_MS
): EstadoAcesso {
  if (servidor === "autenticado") return "liberado";
  if (servidor === "nao_autenticado") return "sessao_encerrada";

  if (!marcador) return "bloqueado_offline";
  if (agora >= marcador.expiraAbsolutaEm) return "bloqueado_offline";
  if (agora - marcador.ultimaValidacaoEm > maximoOfflineMs) return "bloqueado_offline";
  return "liberado";
}

export function lerMarcador(armazenamento: Pick<Storage, "getItem">): MarcadorSessao | null {
  try {
    const bruto = armazenamento.getItem(CHAVE_MARCADOR);
    if (!bruto) return null;
    const m = JSON.parse(bruto) as Partial<MarcadorSessao>;
    if (
      typeof m.usuarioId !== "string" ||
      typeof m.ultimaValidacaoEm !== "number" ||
      typeof m.expiraAbsolutaEm !== "number"
    ) {
      return null;
    }
    const papel = m.papel === "admin" || m.papel === "operador" ? m.papel : undefined;
    return { usuarioId: m.usuarioId, nome: String(m.nome ?? ""), ...(papel && { papel }), ultimaValidacaoEm: m.ultimaValidacaoEm, expiraAbsolutaEm: m.expiraAbsolutaEm };
  } catch {
    return null;
  }
}

export function gravarMarcador(armazenamento: Pick<Storage, "setItem">, marcador: MarcadorSessao): void {
  try {
    armazenamento.setItem(CHAVE_MARCADOR, JSON.stringify(marcador));
  } catch {
    // armazenamento indisponível: sem marcador, o acesso offline fica bloqueado (falha segura)
  }
}

export function apagarMarcador(armazenamento: Pick<Storage, "removeItem">): void {
  try {
    armazenamento.removeItem(CHAVE_MARCADOR);
  } catch {
    // nada a fazer
  }
}
