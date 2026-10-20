import { prisma } from "../prisma/client";
import { criarSessao } from "./sessao.service";
import { bloqueioRestante, devolverTentativa, limparChave, limparExpirados, reservarTentativa } from "./limitador.store";
import { normalizarIp } from "@/lib/auth/ip";
import {
  LIMITE_LOGIN_CONTA,
  LIMITE_LOGIN_IP,
  LIMITE_RECUPERACAO_CONTA,
  LIMITE_RECUPERACAO_IP,
  LIMITE_REDEFINICAO_IP,
} from "@/lib/auth/limitador";
import {
  emailValido,
  gastarTempoDeVerificacao,
  gerarHashSenha,
  normalizarEmail,
  validarPoliticaSenha,
  verificarSenha,
  SENHA_TAMANHO_MAXIMO,
} from "@/lib/auth/senha";
import { gerarToken, hashIdentificador, hashToken } from "@/lib/auth/token";
import { PapelUsuario, TOKEN_RECUPERACAO_MS } from "@/lib/auth/constantes";
import {
  enviarEmail,
  montarEmailRecuperacao,
  MensagemEmail,
  ResultadoEnvioEmail,
} from "@/lib/email/enviar";

export const chaveConta = (email: string) => `login:conta:${hashIdentificador(email)}`;
const chaveIp = (ip: string) => `login:ip:${ip}`;

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

export type ResultadoLogin =
  | {
      ok: true;
      token: string;
      expiraAbsolutaEm: Date;
      usuario: { id: string; nome: string; email: string; papel: PapelUsuario };
    }
  | { ok: false; motivo: "credenciais" }
  | { ok: false; motivo: "bloqueado"; esperaMs: number };

export async function autenticar(
  entrada: { email: string; senha: string; ip: string; userAgent?: string | null },
  agora = new Date()
): Promise<ResultadoLogin> {
  const email = normalizarEmail(entrada.email);
  const contaChave = chaveConta(email);
  // IP canônico: variações de formato do mesmo cliente caem no mesmo contador
  const ipChave = chaveIp(normalizarIp(entrada.ip));

  // Bloqueio vigente: nem a senha certa passa (idêntico para e-mails inexistentes). Não conta.
  const espera = await bloqueioRestante([contaChave, ipChave], agora);
  if (espera > 0) return { ok: false, motivo: "bloqueado", esperaMs: espera };

  // A tentativa é RESERVADA ANTES de verificar a senha (contador travado por linha): uma rajada
  // simultânea não passa do limite; só as que cabem nele chegam a ser avaliadas.
  const reservaConta = await reservarTentativa(contaChave, LIMITE_LOGIN_CONTA, agora);
  const reservaIp = await reservarTentativa(ipChave, LIMITE_LOGIN_IP, agora);
  if (!reservaConta.permitida || !reservaIp.permitida) {
    return { ok: false, motivo: "bloqueado", esperaMs: Math.max(reservaConta.esperaMs, reservaIp.esperaMs) };
  }

  const usuario =
    emailValido(email) && entrada.senha.length <= SENHA_TAMANHO_MAXIMO
      ? await prisma.usuario.findUnique({ where: { email } })
      : null;

  let senhaConfere = false;
  if (usuario && usuario.ativo) {
    senhaConfere = await verificarSenha(entrada.senha, usuario.senha_hash);
  } else {
    await gastarTempoDeVerificacao(entrada.senha.slice(0, SENHA_TAMANHO_MAXIMO));
  }

  if (!usuario || !usuario.ativo || !senhaConfere) {
    return { ok: false, motivo: "credenciais" }; // a tentativa já está contada
  }

  // Sucesso: zera o contador da conta. O do IP NÃO é zerado (quem tem uma conta válida não
  // "lava" tentativas contra outras contas), mas a tentativa bem-sucedida é devolvida: só falhas
  // consomem o limite do IP.
  await limparChave(contaChave);
  await devolverTentativa(ipChave, agora);
  const { token, expiraAbsolutaEm } = await criarSessao(
    usuario.id,
    { ip: entrada.ip, userAgent: entrada.userAgent },
    agora
  );
  await prisma.usuario.update({ where: { id: usuario.id }, data: { ultimo_login_em: agora } });

  if (Math.random() < 0.01) void limparExpirados(agora).catch(() => undefined);

  return {
    ok: true,
    token,
    expiraAbsolutaEm,
    usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, papel: usuario.papel as PapelUsuario },
  };
}

// ---------------------------------------------------------------------------
// Recuperação de senha
// ---------------------------------------------------------------------------

export function urlBase(): string | null {
  const configurada = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (configurada) return configurada;
  // fora de produção, permite testar localmente sem configurar
  return process.env.NODE_ENV === "production" ? null : "http://localhost:3000";
}

type EnviarEmail = (mensagem: MensagemEmail) => Promise<ResultadoEnvioEmail>;

/**
 * Cria um token de recuperação para o usuário e envia o link por e-mail.
 * O link usa APP_URL (nunca o cabeçalho Host da requisição, que o cliente
 * controla). Retorna a promessa do envio para quem quiser aguardá-la.
 */
export async function emitirRecuperacao(
  usuario: { id: string; nome: string; email: string },
  enviar: EnviarEmail = enviarEmail,
  agora = new Date()
): Promise<ResultadoEnvioEmail> {
  const base = urlBase();
  if (!base) {
    console.error("[auth] APP_URL não configurada — link de recuperação não pode ser montado.");
    return { enviado: false, motivo: "nao_configurado" };
  }

  const token = gerarToken();
  await prisma.$transaction([
    // um único link válido por vez: pedidos antigos deixam de funcionar
    prisma.tokenRecuperacao.updateMany({
      where: { usuario_id: usuario.id, usado_em: null },
      data: { usado_em: agora },
    }),
    prisma.tokenRecuperacao.create({
      data: {
        usuario_id: usuario.id,
        token_hash: hashToken(token),
        expira_em: new Date(agora.getTime() + TOKEN_RECUPERACAO_MS),
      },
    }),
  ]);

  const link = `${base}/redefinir-senha?token=${token}`;
  const mensagem = montarEmailRecuperacao(usuario.nome, link, Math.round(TOKEN_RECUPERACAO_MS / 60000));
  return enviar({ para: usuario.email, ...mensagem });
}

/**
 * Pedido público de recuperação. Responde sempre da mesma forma — exista ou
 * não o e-mail, esteja ou não limitado — e dispara o envio em segundo plano
 * para que o tempo de resposta também não revele nada.
 */
export async function solicitarRecuperacao(
  entrada: { email: string; ip: string },
  enviar: EnviarEmail = enviarEmail,
  agora = new Date()
): Promise<{ envio: Promise<ResultadoEnvioEmail> | null }> {
  const email = normalizarEmail(entrada.email);
  if (!emailValido(email)) return { envio: null };

  const ipChave = `rec:ip:${normalizarIp(entrada.ip)}`;
  const contaChaveRec = `rec:conta:${hashIdentificador(email)}`;

  // Cada pedido é RESERVADO de forma atômica antes de qualquer envio (conta-se também e-mails
  // inexistentes, para a resposta e o ritmo não revelarem se a conta existe).
  const reservaIp = await reservarTentativa(ipChave, LIMITE_RECUPERACAO_IP, agora);
  const reservaConta = await reservarTentativa(contaChaveRec, LIMITE_RECUPERACAO_CONTA, agora);
  if (!reservaIp.permitida || !reservaConta.permitida) return { envio: null };

  const usuario = await prisma.usuario.findUnique({ where: { email } });
  if (!usuario || !usuario.ativo) return { envio: null };

  const envio = emitirRecuperacao(usuario, enviar, agora).catch((e) => {
    console.error(`[auth] falha ao emitir recuperação: ${(e as Error).name}`);
    return { enviado: false, motivo: "falha_provedor" } as ResultadoEnvioEmail;
  });
  return { envio };
}

async function buscarTokenValido(token: string, agora: Date) {
  if (!token || token.length > 200) return null;
  const registro = await prisma.tokenRecuperacao.findUnique({
    where: { token_hash: hashToken(token) },
    include: { usuario: true },
  });
  if (!registro || registro.usado_em || registro.expira_em <= agora || !registro.usuario.ativo) return null;
  return registro;
}

/** Usado pela página para mostrar "link inválido" antes de pedir a nova senha. */
export async function tokenRecuperacaoValido(token: string, agora = new Date()): Promise<boolean> {
  return (await buscarTokenValido(token, agora)) !== null;
}

export type ResultadoRedefinicao =
  | { ok: true }
  | { ok: false; motivo: "token_invalido" }
  | { ok: false; motivo: "bloqueado"; esperaMs: number }
  | { ok: false; motivo: "senha_fraca"; erros: string[] };

export async function redefinirSenha(
  entrada: { token: string; novaSenha: string; ip: string },
  agora = new Date()
): Promise<ResultadoRedefinicao> {
  const ipChave = `rec:conf:${normalizarIp(entrada.ip)}`;
  const espera = await bloqueioRestante([ipChave], agora);
  if (espera > 0) return { ok: false, motivo: "bloqueado", esperaMs: espera };

  // tentativa reservada antes (atômico); devolvida se o token era válido e a senha foi trocada
  const reserva = await reservarTentativa(ipChave, LIMITE_REDEFINICAO_IP, agora);
  if (!reserva.permitida) return { ok: false, motivo: "bloqueado", esperaMs: reserva.esperaMs };

  const registro = await buscarTokenValido(entrada.token, agora);
  if (!registro) return { ok: false, motivo: "token_invalido" };

  const erros = validarPoliticaSenha(entrada.novaSenha, registro.usuario.email);
  if (erros.length > 0) {
    await devolverTentativa(ipChave, agora); // token válido: senha fraca não consome o limite
    return { ok: false, motivo: "senha_fraca", erros };
  }

  const senha_hash = await gerarHashSenha(entrada.novaSenha);

  const consumido = await prisma.$transaction(async (tx) => {
    // consumo atômico: dois pedidos simultâneos com o mesmo token — só um vence
    const { count } = await tx.tokenRecuperacao.updateMany({
      where: { id: registro.id, usado_em: null, expira_em: { gt: agora } },
      data: { usado_em: agora },
    });
    if (count !== 1) return false;

    await tx.usuario.update({
      where: { id: registro.usuario_id },
      data: { senha_hash, senha_alterada_em: agora },
    });
    await tx.tokenRecuperacao.updateMany({
      where: { usuario_id: registro.usuario_id, usado_em: null },
      data: { usado_em: agora },
    });
    // sessões antigas (inclusive de quem pode ter roubado a senha) deixam de valer
    await tx.sessao.deleteMany({ where: { usuario_id: registro.usuario_id } });
    return true;
  });

  if (!consumido) return { ok: false, motivo: "token_invalido" };

  await devolverTentativa(ipChave, agora);
  await limparChave(chaveConta(registro.usuario.email));
  return { ok: true };
}
