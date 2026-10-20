import { createHash, timingSafeEqual } from "node:crypto";
import { prisma } from "../prisma/client";
import { bloqueioRestante, limparChave, registrarFalha } from "./limitador.store";
import { urlBase } from "./auth.service";
import {
  bloqueioRestanteMs,
  LIMITE_ATIVACAO_CODIGO_IP,
  LIMITE_ATIVACAO_ENVIO_IP,
  LIMITE_ATIVACAO_TOKEN_IP,
} from "@/lib/auth/limitador";
import { emailValido, gerarHashSenha, normalizarEmail, validarPoliticaSenha, SENHA_TAMANHO_MAXIMO } from "@/lib/auth/senha";
import { gerarToken, hashToken } from "@/lib/auth/token";
import { normalizarIp } from "@/lib/auth/ip";
import { TOKEN_ATIVACAO_MS } from "@/lib/auth/constantes";
import { emailConfigurado, enviarEmail, montarEmailAtivacao, MensagemEmail, ResultadoEnvioEmail } from "@/lib/email/enviar";

/**
 * Ativação inicial da conta principal pelo próprio cliente.
 *
 *  1. Autorização de inicialização: a variável de ambiente ATIVACAO_INICIAL_CODIGO (segredo
 *     definido na infraestrutura, nunca no código/Git). Sem ela, o fluxo está DESLIGADO.
 *  2. Pedido: e-mail + nome + senha forte. Nenhum acesso é concedido aqui: grava-se um pedido
 *     pendente (senha só como hash Argon2id) e envia-se um link de uso único ao e-mail.
 *  3. Confirmação: abrir o link e confirmar cria a conta principal. Confirmar o e-mail SOZINHO não
 *     basta — o link só existe porque o código de inicialização foi aceito no passo 2.
 *  4. Uma só conta: a criação roda numa transação com lock de aviso (pg_advisory_xact_lock) que
 *     confere "zero usuários". Depois da primeira conta o fluxo se encerra.
 *
 * Nunca se simula sucesso: sem e-mail/APP_URL configurados nada é gravado e nada é liberado.
 */

export const CODIGO_TAMANHO_MINIMO = 24;
/** Chave do lock de aviso que serializa a criação da conta principal. */
const LOCK_ATIVACAO = 7_310_042;

type EnviarEmail = (mensagem: MensagemEmail) => Promise<ResultadoEnvioEmail>;

export function codigoDeInicializacaoConfigurado(): boolean {
  return (process.env.ATIVACAO_INICIAL_CODIGO ?? "").length >= CODIGO_TAMANHO_MINIMO;
}

/** Comparação em tempo constante (compara SHA-256 de ambos, de tamanho fixo). */
function codigoConfere(informado: string): boolean {
  const esperado = process.env.ATIVACAO_INICIAL_CODIGO ?? "";
  if (esperado.length < CODIGO_TAMANHO_MINIMO) return false;
  const a = createHash("sha256").update(informado).digest();
  const b = createHash("sha256").update(esperado).digest();
  return timingSafeEqual(a, b);
}

/**
 * Fluxo já encerrado (existe conta): descarta qualquer pedido pendente que tenha sobrado (ex.: a conta
 * foi criada pelo script enquanto havia um pedido), junto com o hash de senha que ele guardava.
 * Melhor esforço — o pedido já é inútil, pois toda confirmação confere "zero usuários".
 */
async function descartarPedidosPendentes(): Promise<void> {
  try {
    await prisma.ativacaoInicial.deleteMany({});
  } catch {
    // sem efeito sobre a segurança: confirmar continua recusado
  }
}

export type SituacaoAtivacao = "disponivel" | "encerrada" | "desligada" | "email_nao_configurado";

/** Situação do fluxo, para a página decidir o que mostrar (sem revelar nada além disso). */
export async function situacaoAtivacao(): Promise<SituacaoAtivacao> {
  if ((await prisma.usuario.count()) > 0) {
    await descartarPedidosPendentes();
    return "encerrada";
  }
  if (!codigoDeInicializacaoConfigurado()) return "desligada";
  if (!emailConfigurado() || !urlBase()) return "email_nao_configurado";
  return "disponivel";
}

export type ResultadoSolicitacao =
  | { ok: true }
  | { ok: false; motivo: "indisponivel" | "codigo_invalido" | "email_nao_configurado" | "falha_envio" }
  | { ok: false; motivo: "bloqueado"; esperaMs: number }
  | { ok: false; motivo: "dados_invalidos"; erro: string };

export async function solicitarAtivacao(
  entrada: { codigo: string; nome: string; email: string; senha: string; ip: string },
  enviar: EnviarEmail = enviarEmail,
  agora = new Date()
): Promise<ResultadoSolicitacao> {
  const situacao = await situacaoAtivacao();
  if (situacao === "encerrada" || situacao === "desligada") return { ok: false, motivo: "indisponivel" };

  // IP canônico: variações de formato do mesmo cliente não ganham contadores separados
  const ip = normalizarIp(entrada.ip);
  const chaveCodigo = `ativ:codigo:${ip}`;
  const chaveEnvio = `ativ:envio:${ip}`;
  const espera = await bloqueioRestante([chaveCodigo, chaveEnvio], agora);
  if (espera > 0) return { ok: false, motivo: "bloqueado", esperaMs: espera };

  // 1) autorização: nada mais é examinado antes de o código conferir.
  // A tentativa é CONTADA ANTES de conferir (o contador é travado com FOR UPDATE), então uma rajada
  // simultânea de palpites não passa do limite: só as que ficam abaixo dele chegam a ser avaliadas.
  const estado = await registrarFalha(chaveCodigo, LIMITE_ATIVACAO_CODIGO_IP, agora);
  const esperaApos = bloqueioRestanteMs(estado, agora);
  if (esperaApos > 0) return { ok: false, motivo: "bloqueado", esperaMs: esperaApos };
  if (!codigoConfere(entrada.codigo.slice(0, 512))) return { ok: false, motivo: "codigo_invalido" };
  await limparChave(chaveCodigo); // código certo: não acumula erros antigos

  // 2) sem e-mail configurado nada é gravado nem liberado
  if (situacao === "email_nao_configurado") return { ok: false, motivo: "email_nao_configurado" };

  const email = normalizarEmail(entrada.email);
  const nome = entrada.nome.trim();
  if (nome.length < 2 || nome.length > 120) return { ok: false, motivo: "dados_invalidos", erro: "Informe o nome (2 a 120 caracteres)." };
  if (!emailValido(email)) return { ok: false, motivo: "dados_invalidos", erro: "E-mail inválido." };
  if (entrada.senha.length > SENHA_TAMANHO_MAXIMO) return { ok: false, motivo: "dados_invalidos", erro: "Senha longa demais." };
  const erros = validarPoliticaSenha(entrada.senha, email);
  if (erros.length > 0) return { ok: false, motivo: "dados_invalidos", erro: erros[0] };

  // pedidos de envio também são contados antes (atômico): limite de 4 no contador = 3 e-mails por hora e IP
  const envioEstado = await registrarFalha(chaveEnvio, LIMITE_ATIVACAO_ENVIO_IP, agora);
  const esperaEnvio = bloqueioRestanteMs(envioEstado, agora);
  if (esperaEnvio > 0) return { ok: false, motivo: "bloqueado", esperaMs: esperaEnvio };

  const senha_hash = await gerarHashSenha(entrada.senha);
  const token = gerarToken();

  const gravado = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_ATIVACAO})`;
    if ((await tx.usuario.count()) > 0) return null;
    // um único pedido por vez: o anterior (e o link dele) deixa de existir, junto com o hash da senha
    await tx.ativacaoInicial.deleteMany({});
    return tx.ativacaoInicial.create({
      data: { email, nome, senha_hash, token_hash: hashToken(token), expira_em: new Date(agora.getTime() + TOKEN_ATIVACAO_MS) },
      select: { id: true },
    });
  });
  if (!gravado) return { ok: false, motivo: "indisponivel" };

  const link = `${urlBase()}/ativar-conta?token=${token}`;
  const mensagem = montarEmailAtivacao(nome, link, Math.round(TOKEN_ATIVACAO_MS / 60000));
  let envio: ResultadoEnvioEmail;
  try {
    envio = await enviar({ para: email, ...mensagem });
  } catch {
    envio = { enviado: false, motivo: "falha_provedor" };
  }
  if (!envio.enviado) {
    // não houve entrega: o pedido (e o hash da senha) é apagado e o link deixa de existir; nada é liberado
    await prisma.ativacaoInicial.deleteMany({ where: { id: gravado.id } });
    return { ok: false, motivo: envio.motivo === "nao_configurado" ? "email_nao_configurado" : "falha_envio" };
  }
  return { ok: true };
}

/** Para a página do link: fluxo aberto, código de inicialização ainda configurado e token vigente? */
export async function tokenAtivacaoValido(token: string, agora = new Date()): Promise<boolean> {
  if (!codigoDeInicializacaoConfigurado() || !token || token.length > 200) return false;
  if ((await prisma.usuario.count()) > 0) {
    await descartarPedidosPendentes();
    return false;
  }
  const r = await prisma.ativacaoInicial.findUnique({ where: { token_hash: hashToken(token) } });
  return Boolean(r && !r.usado_em && r.expira_em > agora);
}

export type ResultadoConfirmacao =
  | { ok: true; email: string }
  | { ok: false; motivo: "token_invalido" | "encerrada" }
  | { ok: false; motivo: "bloqueado"; esperaMs: number };

export async function confirmarAtivacao(
  entrada: { token: string; ip: string },
  agora = new Date()
): Promise<ResultadoConfirmacao> {
  const chave = `ativ:token:${normalizarIp(entrada.ip)}`;
  const espera = await bloqueioRestante([chave], agora);
  if (espera > 0) return { ok: false, motivo: "bloqueado", esperaMs: espera };

  if (!codigoDeInicializacaoConfigurado()) return { ok: false, motivo: "encerrada" };
  const token = typeof entrada.token === "string" ? entrada.token : "";

  const resultado = await prisma.$transaction(async (tx): Promise<ResultadoConfirmacao> => {
    // serializa: duas confirmações simultâneas nunca criam duas contas
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_ATIVACAO})`;
    if ((await tx.usuario.count()) > 0) {
      await tx.ativacaoInicial.deleteMany({});
      return { ok: false, motivo: "encerrada" };
    }

    const pedido =
      token && token.length <= 200 ? await tx.ativacaoInicial.findUnique({ where: { token_hash: hashToken(token) } }) : null;
    if (!pedido || pedido.usado_em || pedido.expira_em <= agora) return { ok: false, motivo: "token_invalido" };

    await tx.usuario.create({
      data: { email: pedido.email, nome: pedido.nome, senha_hash: pedido.senha_hash, papel: "admin", senha_alterada_em: agora },
    });
    // encerra o fluxo: nenhum pedido (nem o hash da senha, já copiado para a conta) permanece
    await tx.ativacaoInicial.deleteMany({});
    return { ok: true, email: pedido.email };
  });

  if (!resultado.ok && resultado.motivo === "token_invalido") {
    await registrarFalha(chave, LIMITE_ATIVACAO_TOKEN_IP, agora);
  }
  return resultado;
}
