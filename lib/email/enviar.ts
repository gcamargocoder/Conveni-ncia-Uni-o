/**
 * Envio de e-mail transacional via API HTTP da Resend (https://resend.com).
 * Escolhido por ser HTTPS: o Railway bloqueia SMTP de saída em planos
 * básicos. Configuração 100% por variáveis de ambiente:
 *
 *   RESEND_API_KEY  chave da API (secreta)
 *   EMAIL_FROM      remetente, ex.: "Conveniência União <nao-responder@seudominio.com.br>"
 *                   (o domínio precisa estar verificado na Resend)
 *
 * Nunca se simula envio: sem configuração, devolve { enviado: false } e o
 * chamador decide o que fazer. O conteúdo da mensagem (que contém o link com
 * o token) nunca é escrito nos logs.
 */

export interface MensagemEmail {
  para: string;
  assunto: string;
  texto: string;
  html: string;
}

export interface ResultadoEnvioEmail {
  enviado: boolean;
  motivo?: "nao_configurado" | "falha_provedor";
}

export function emailConfigurado(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export type VariavelEmail = "RESEND_API_KEY" | "EMAIL_FROM" | "APP_URL";

/**
 * Quais das três variáveis exigidas pelo fluxo de e-mail estão ausentes (vazias contam como ausentes).
 * APP_URL só é exigida em produção (fora dela o link cai em localhost, como em `urlBase`). Nunca devolve valores.
 */
export function variaveisEmailAusentes(
  env: Record<string, string | undefined> = process.env,
  producao: boolean = process.env.NODE_ENV === "production"
): VariavelEmail[] {
  const ausentes: VariavelEmail[] = [];
  if (!env.RESEND_API_KEY?.trim()) ausentes.push("RESEND_API_KEY");
  if (!env.EMAIL_FROM?.trim()) ausentes.push("EMAIL_FROM");
  if (producao && !env.APP_URL?.trim()) ausentes.push("APP_URL");
  return ausentes;
}

/** Texto do aviso do menu Usuários: diz exatamente o que falta e o que fica sem funcionar (sem prometer envio). */
export function descreverEmailAusente(ausentes: VariavelEmail[]): string {
  const faltam = ausentes.join(", ");
  return (
    `Faltam no servidor: ${faltam}. Enquanto isso, o sistema NÃO envia e-mails: a recuperação de senha e o convite de ` +
    `ativação não funcionam. O login, os PINs e o restante do sistema não são afetados. Veja AUTENTICACAO.md.`
  );
}

export async function enviarEmail(mensagem: MensagemEmail): Promise<ResultadoEnvioEmail> {
  const chave = process.env.RESEND_API_KEY;
  const remetente = process.env.EMAIL_FROM;

  if (!chave || !remetente) {
    console.error("[email] RESEND_API_KEY/EMAIL_FROM não configurados — e-mail não enviado.");
    return { enviado: false, motivo: "nao_configurado" };
  }

  try {
    const resposta = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: remetente,
        to: [mensagem.para],
        subject: mensagem.assunto,
        text: mensagem.texto,
        html: mensagem.html,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!resposta.ok) {
      console.error(`[email] provedor respondeu HTTP ${resposta.status}.`);
      return { enviado: false, motivo: "falha_provedor" };
    }
    return { enviado: true };
  } catch (e) {
    console.error(`[email] falha ao contatar o provedor: ${(e as Error).name}`);
    return { enviado: false, motivo: "falha_provedor" };
  }
}

const ENTIDADES_HTML: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escaparHtml(texto: string): string {
  return texto.replace(/[&<>"']/g, (c) => ENTIDADES_HTML[c]);
}

export function montarEmailRecuperacao(
  nome: string,
  link: string,
  minutosValidade: number
): Omit<MensagemEmail, "para"> {
  return {
    assunto: "Redefinição de senha — Conveniência União",
    texto:
      `Olá, ${nome}.\n\nRecebemos um pedido para redefinir a sua senha. ` +
      `Use o link abaixo (válido por ${minutosValidade} minutos e de uso único):\n\n${link}\n\n` +
      `Se você não fez esse pedido, ignore este e-mail — a sua senha continua a mesma.`,
    html:
      `<p>Olá, ${escaparHtml(nome)}.</p>` +
      `<p>Recebemos um pedido para redefinir a sua senha. O link abaixo é válido por ${minutosValidade} minutos e só pode ser usado uma vez:</p>` +
      `<p><a href="${escaparHtml(link)}">Redefinir minha senha</a></p>` +
      `<p style="color:#64748b;font-size:13px">Se você não fez esse pedido, ignore este e-mail — a sua senha continua a mesma.</p>`,
  };
}

export function montarEmailAtivacao(nome: string, link: string, minutosValidade: number): Omit<MensagemEmail, "para"> {
  return {
    assunto: "Confirme a ativação da conta — Conveniência União",
    texto:
      `Olá, ${nome}.

Foi pedido o primeiro acesso (conta principal) do sistema com este e-mail. ` +
      `Para confirmar, abra o link abaixo (válido por ${minutosValidade} minutos e de uso único):

${link}

` +
      `Se não foi você, ignore este e-mail — nada será ativado.`,
    html:
      `<p>Olá, ${escaparHtml(nome)}.</p>` +
      `<p>Foi pedido o primeiro acesso (conta principal) do sistema com este e-mail. O link abaixo é válido por ${minutosValidade} minutos e só pode ser usado uma vez:</p>` +
      `<p><a href="${escaparHtml(link)}">Confirmar ativação da conta</a></p>` +
      `<p style="color:#64748b;font-size:13px">Se não foi você, ignore este e-mail — nada será ativado.</p>`,
  };
}
