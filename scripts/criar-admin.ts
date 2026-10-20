/**
 * Cria (uma única vez) o primeiro administrador do sistema.
 *
 * Não existe cadastro público nem senha padrão: este script é o único caminho
 * para o primeiro acesso, e exige acesso ao banco (DATABASE_URL), ou seja,
 * quem tem acesso à infraestrutura. Uso:
 *
 *   npm run admin:criar -- --email voce@empresa.com --nome "Seu Nome"
 *
 * A senha é pedida no terminal (digitação oculta). Em ambientes sem terminal
 * interativo, pode ser passada pela variável ADMIN_SENHA — apague-a depois.
 *
 * Por segurança, o script recusa-se a rodar se já existir um administrador
 * ativo (use "--forcar" apenas para recuperar o acesso quando todos os
 * administradores foram perdidos; com --forcar, um e-mail já existente tem
 * a senha redefinida e é promovido/reativado como administrador).
 */
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { prisma } from "../services/prisma/client";
import { emailValido, gerarHashSenha, normalizarEmail, validarPoliticaSenha } from "../lib/auth/senha";

function argumento(nome: string): string | undefined {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function perguntar(pergunta: string, oculto = false): Promise<string> {
  let mudo = false;
  const saida = new Writable({
    write(chunk, _enc, cb) {
      if (!mudo) process.stdout.write(chunk);
      cb();
    },
  });
  const rl = createInterface({ input: process.stdin, output: saida, terminal: true });
  return new Promise((resolver) => {
    process.stdout.write(pergunta);
    mudo = oculto;
    rl.question("", (resposta) => {
      rl.close();
      if (oculto) process.stdout.write("\n");
      resolver(resposta);
    });
  });
}

async function principal() {
  const forcar = process.argv.includes("--forcar");
  const email = normalizarEmail(argumento("email") ?? (await perguntar("E-mail do administrador: ")));
  const nome = (argumento("nome") ?? (await perguntar("Nome: "))).trim();

  if (!emailValido(email)) throw new Error("E-mail inválido.");
  if (nome.length < 2) throw new Error("Informe o nome.");

  const adminsAtivos = await prisma.usuario.count({ where: { papel: "admin", ativo: true } });
  if (adminsAtivos > 0 && !forcar) {
    throw new Error(
      "Já existe um administrador ativo. Entre no sistema e use a tela Usuários. " +
        '(Para recuperar acesso perdido, rode novamente com "--forcar".)'
    );
  }

  let senha = process.env.ADMIN_SENHA;
  if (!senha) {
    if (!process.stdin.isTTY) throw new Error("Sem terminal interativo: informe a senha pela variável ADMIN_SENHA.");
    senha = await perguntar("Senha (não aparece enquanto digita): ", true);
    const confirmacao = await perguntar("Confirme a senha: ", true);
    if (senha !== confirmacao) throw new Error("As senhas não coincidem.");
  }

  const erros = validarPoliticaSenha(senha, email);
  if (erros.length > 0) throw new Error(erros.join(" "));

  const senha_hash = await gerarHashSenha(senha);
  const existente = await prisma.usuario.findUnique({ where: { email } });

  if (existente) {
    if (!forcar) throw new Error("Já existe um usuário com este e-mail. Use --forcar para redefinir e promover.");
    await prisma.$transaction([
      prisma.usuario.update({
        where: { id: existente.id },
        data: { senha_hash, papel: "admin", ativo: true, nome, senha_alterada_em: new Date() },
      }),
      prisma.sessao.deleteMany({ where: { usuario_id: existente.id } }),
    ]);
    console.log(`Administrador ${email} redefinido e reativado. Sessões anteriores encerradas.`);
  } else {
    // conta única: nunca cria uma segunda conta de login, nem com --forcar
    if ((await prisma.usuario.count()) > 0) {
      throw new Error("Já existe uma conta de login. O sistema admite uma única conta principal; use o e-mail dela com --forcar para recuperar o acesso.");
    }
    await prisma.usuario.create({
      data: { email, nome, senha_hash, papel: "admin", senha_alterada_em: new Date() },
    });
    console.log(`Administrador ${email} criado. Entre em /login.`);
  }
}

principal()
  .catch((e) => {
    console.error(`Erro: ${(e as Error).message}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
