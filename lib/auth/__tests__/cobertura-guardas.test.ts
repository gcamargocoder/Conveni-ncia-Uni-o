import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Rede de segurança contra esquecimento: se alguém criar uma Server Action ou
 * uma página nova sem checar a sessão, estes testes quebram. Ler o código-fonte
 * é deliberado — o objetivo é garantir a PRESENÇA da checagem em toda entrada.
 */

const RAIZ = path.resolve(__dirname, "../../..");

function listar(dir: string, filtro: (arquivo: string) => boolean, acumulado: string[] = []): string[] {
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".next", "__tests__"].includes(entrada.name)) continue;
    const completo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) listar(completo, filtro, acumulado);
    else if (filtro(completo)) acumulado.push(completo);
  }
  return acumulado;
}

const relativo = (arquivo: string) => path.relative(RAIZ, arquivo).replace(/\\/g, "/");

// Únicas Server Actions que PRECISAM ser públicas: o fluxo de login/recuperação em si.
const ACTIONS_PUBLICAS = new Set([
  "lib/auth/sessao-actions.ts:loginAction",
  "lib/auth/sessao-actions.ts:logoutAction",
  "lib/auth/sessao-actions.ts:solicitarRecuperacaoAction",
  "lib/auth/sessao-actions.ts:redefinirSenhaAction",
  "lib/auth/sessao-actions.ts:validarTokenRecuperacaoAction",
  "lib/auth/sessao-actions.ts:verificarSessaoAction", // só informa sobre a própria sessão de quem pergunta
  // ativação inicial: públicas por natureza; só funcionam com ATIVACAO_INICIAL_CODIGO e sem nenhum usuário (service)
  "lib/auth/ativacao-actions.ts:solicitarAtivacaoAction",
  "lib/auth/ativacao-actions.ts:confirmarAtivacaoAction",
  "lib/auth/ativacao-actions.ts:validarTokenAtivacaoAction",
]);

describe("toda Server Action verifica o acesso", () => {
  const arquivos = [
    ...listar(path.join(RAIZ, "lib"), (a) => a.endsWith(".ts")),
    ...listar(path.join(RAIZ, "app"), (a) => /\.(ts|tsx)$/.test(a)),
    ...listar(path.join(RAIZ, "components"), (a) => /\.(ts|tsx)$/.test(a)),
  ].filter((a) => /^\s*["']use server["']/.test(fs.readFileSync(a, "utf8")));

  it("encontra os arquivos de actions", () => {
    expect(arquivos.length).toBeGreaterThanOrEqual(12);
  });

  for (const arquivo of arquivos) {
    const fonte = fs.readFileSync(arquivo, "utf8");
    const partes = fonte.split(/export async function (\w+)/);
    // partes: [pre, nome1, corpo1, nome2, corpo2, ...]
    for (let i = 1; i < partes.length; i += 2) {
      const nome = partes[i];
      const corpo = partes[i + 1];
      const chave = `${relativo(arquivo)}:${nome}`;

      it(`${chave}`, () => {
        if (ACTIONS_PUBLICAS.has(chave)) return;
        expect(corpo, `${chave} não chama verificarAcesso()`).toMatch(/verificarAcesso\(/);
        // a verificação deve vir ANTES de qualquer acesso a dados
        const posGuarda = corpo.indexOf("verificarAcesso(");
        const posDados = corpo.search(/await (?!verificarAcesso)\w+\(/);
        expect(posGuarda).toBeGreaterThanOrEqual(0);
        if (posDados >= 0) expect(posGuarda).toBeLessThanOrEqual(posDados);
      });
    }
  }

  it("as actions administrativas exigem papel de administrador", () => {
    for (const rel of ["lib/usuarios/actions.ts", "lib/backup/actions.ts"]) {
      const fonte = fs.readFileSync(path.join(RAIZ, rel), "utf8");
      const chamadas = fonte.match(/verificarAcesso\(([^)]*)\)/g) ?? [];
      expect(chamadas.length).toBeGreaterThan(0);
      for (const c of chamadas) expect(c).toContain('"admin"');
    }
  });
});

// Páginas sem checagem no servidor, com o motivo.
const PAGINAS_SEM_GUARDA: Record<string, string> = {
  "app/login/page.tsx": "pública",
  "app/recuperar-senha/page.tsx": "pública",
  "app/redefinir-senha/page.tsx": "pública (valida o token)",
  "app/configurar-conta/page.tsx": "pública (só abre com ATIVACAO_INICIAL_CODIGO e sem nenhum usuário)",
  "app/ativar-conta/page.tsx": "pública (valida o token; só com fluxo aberto)",
  "app/offline/page.tsx": "pública: fallback do service worker, sem dados",
  "app/page.tsx": "apenas redireciona para /pdv (protegido)",
  "app/(dashboard)/sincronizacao/page.tsx": 'página de cliente; protegida pelo layout "app/(dashboard)/sincronizacao/layout.tsx"',
};

describe("toda página privada exige sessão no servidor", () => {
  const paginas = listar(path.join(RAIZ, "app"), (a) => /[\\/]page\.tsx$/.test(a));

  it("encontra as páginas", () => {
    expect(paginas.length).toBeGreaterThanOrEqual(15);
  });

  for (const pagina of paginas) {
    const rel = relativo(pagina);
    it(rel, () => {
      if (rel in PAGINAS_SEM_GUARDA) return;
      expect(fs.readFileSync(pagina, "utf8"), `${rel} não chama exigirSessao()/exigirAdmin()`).toMatch(
        /await (exigirSessao|exigirAdmin)\(\)/
      );
    });
  }

  it("a página de sincronização (cliente) é protegida por um layout de servidor", () => {
    const layout = fs.readFileSync(path.join(RAIZ, "app/(dashboard)/sincronizacao/layout.tsx"), "utf8");
    expect(layout).toMatch(/await exigirSessao\(\)/);
  });

  it("páginas administrativas exigem admin", () => {
    for (const rel of ["app/usuarios/page.tsx", "app/backup/page.tsx"]) {
      expect(fs.readFileSync(path.join(RAIZ, rel), "utf8")).toMatch(/await exigirAdmin\(\)/);
    }
  });
});
