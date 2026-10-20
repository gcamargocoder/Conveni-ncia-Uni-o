import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { ROTAS_PUBLICAS } from "../constantes";

/**
 * Regra de negócio: a entrada do sistema é só e-mail + senha. Não há cadastro público de
 * contas, nem criação de contas nas telas públicas. Estes testes quebram se alguém
 * acrescentar isso por engano.
 */
const RAIZ = path.resolve(__dirname, "../../..");
const ler = (arquivo: string) => readFileSync(path.join(RAIZ, arquivo), "utf8");

function arquivos(dir: string): string[] {
  const completo = path.join(RAIZ, dir);
  if (!existsSync(completo)) return [];
  return readdirSync(completo, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? arquivos(path.join(dir, e.name)) : [path.join(dir, e.name)]
  );
}

describe("tela de login", () => {
  const form = ler("components/auth/FormLogin.tsx");

  it("tem somente e-mail, senha, Entrar e Esqueci minha senha", () => {
    expect((form.match(/<Input\b/g) ?? []).length).toBe(1);
    expect((form.match(/<CampoSenha\b/g) ?? []).length).toBe(1);
    expect(form).toContain('name="email"');
    expect(form).toContain('name="senha"');
    expect(form).toMatch(/>\s*Entrar\s*</);
    expect(form).toMatch(/Esqueci minha senha/);
    expect(form).toContain('href="/recuperar-senha"');
    expect((form.match(/<Link\b/g) ?? []).length).toBe(1); // nenhum outro link (ex.: criar conta)
    expect((form.match(/type="submit"/g) ?? []).length).toBe(1);
  });

  it.each(["app/login", "app/recuperar-senha", "app/redefinir-senha", "components/auth"])(
    "%s não oferece criar conta / cadastro / registro",
    (dir) => {
      for (const arquivo of arquivos(dir).filter((f) => /\.(tsx?|jsx?)$/.test(f))) {
        const texto = readFileSync(path.join(RAIZ, arquivo), "utf8");
        expect(texto, arquivo).not.toMatch(/criar (uma )?conta|cadastre-se|registre-se|nova conta|sign ?up|register/i);
      }
    }
  );
});

describe("não existe cadastro público", () => {
  it("as rotas públicas são só login, recuperação, redefinição, ativação inicial e a página offline", () => {
    expect([...ROTAS_PUBLICAS].sort()).toEqual(["/ativar-conta", "/configurar-conta", "/login", "/offline", "/recuperar-senha", "/redefinir-senha"]);
  });

  it("as Server Actions sem sessão exigida são só as de entrar/sair/recuperar senha", () => {
    const fonte = ler("lib/auth/sessao-actions.ts");
    const exportadas = [...fonte.matchAll(/export async function (\w+)/g)].map((m) => m[1]).sort();
    expect(exportadas).toEqual(
      ["loginAction", "logoutAction", "redefinirSenhaAction", "solicitarRecuperacaoAction", "validarTokenRecuperacaoAction", "verificarSessaoAction"].sort()
    );
  });

  it("a ativação inicial expõe só 3 ações públicas e o login continua sem cadastro", () => {
    const fonte = ler("lib/auth/ativacao-actions.ts");
    const exportadas = [...fonte.matchAll(/export async function (\w+)/g)].map((m) => m[1]).sort();
    expect(exportadas).toEqual(["confirmarAtivacaoAction", "solicitarAtivacaoAction", "validarTokenAtivacaoAction"]);
  });

  it("não há rotas de API (route.ts) que pudessem criar contas", () => {
    expect(arquivos("app").filter((f) => /route\.(ts|js)$/.test(f))).toEqual([]);
  });

  it("a tela Usuários não cria contas: sem ação, sem serviço, sem formulário", () => {
    const acoes = ler("lib/usuarios/actions.ts");
    const servico = ler("services/usuarios.service.ts");
    expect(acoes).not.toMatch(/export async function (criar|cadastr|novo)/i);
    expect(servico).not.toMatch(/export (async )?function (criar|cadastr|novo)/i);
    expect(servico).not.toMatch(/usuario.create|usuario.upsert|createMany/);
    expect(acoes).not.toMatch(/usuario.create|usuario.upsert|createMany/);
    expect(existsSync(path.join(RAIZ, "components/usuarios/UsuarioCadastroModal.tsx"))).toBe(false);
    expect(ler("app/usuarios/page.tsx")).not.toMatch(/Cadastro|Novo usuário/);
  });

  it("nenhum código da aplicação (fora de scripts e testes) cria usuários", () => {
    for (const dir of ["app", "components", "lib", "services", "hooks"]) {
      for (const arquivo of arquivos(dir).filter((f) => /\.(tsx?|jsx?)$/.test(f) && !f.includes("__tests__") && !f.endsWith("ativacao.service.ts"))) {
        expect(readFileSync(path.join(RAIZ, arquivo), "utf8"), arquivo).not.toMatch(/usuario.(create|createMany|upsert)/);
      }
    }
  });

  it("a criação de usuário não é chamada por nenhuma tela pública", () => {
    for (const arquivo of [...arquivos("app/login"), ...arquivos("app/recuperar-senha"), ...arquivos("app/redefinir-senha"), ...arquivos("components/auth")]) {
      expect(readFileSync(path.join(RAIZ, arquivo), "utf8"), arquivo).not.toMatch(/criarUsuario|UsuarioCadastroModal/);
    }
  });

  it("não há senha padrão fixa nem seed de usuários no projeto", () => {
    const pacote = JSON.parse(ler("package.json"));
    expect(pacote.prisma?.seed).toBeUndefined();
    expect(existsSync(path.join(RAIZ, "prisma/seed.ts"))).toBe(false);
    expect(ler("prisma/migrations/20260102000000_autenticacao/migration.sql")).not.toMatch(/INSERT INTO "?usuarios/i);
    expect(ler(".env.example")).toMatch(/# ADMIN_SENHA=""|# ADMIN_SENHA/); // comentada: nunca ativa por padrão
  });
});
