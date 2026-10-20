/**
 * Verificação da configuração de produção (variáveis de ambiente). Função pura e sem efeitos: recebe o
 * ambiente e devolve achados. NUNCA inclui valores de variáveis nos achados — só nomes e o motivo —, de modo
 * que a saída pode ser colada em um ticket sem expor segredos.
 *
 * O que NÃO dá para verificar daqui (depende do Railway/Resend): se o domínio do remetente está verificado, se a
 * chave tem permissão de envio e se o e-mail chega. Para isso há as verificações opcionais `--resend` (consulta
 * somente-leitura à API, sem enviar nada) e `--dns` no script `npm run verificar:producao`.
 */

export type Nivel = "erro" | "aviso" | "ok";
export interface Achado {
  nivel: Nivel;
  variavel: string;
  mensagem: string;
}

type Ambiente = Record<string, string | undefined>;

const CODIGO_MINIMO = 24;

/** Extrai o domínio do remetente: "Nome <a@dominio.com>" ou "a@dominio.com". */
export function dominioDoRemetente(emailFrom: string | undefined): string | null {
  if (!emailFrom) return null;
  const m = /<([^<>@\s]+@([^<>@\s]+))>/.exec(emailFrom) ?? /^\s*([^<>@\s]+@([^<>@\s]+))\s*$/.exec(emailFrom);
  return m ? m[2].toLowerCase() : null;
}

function entropiaBaixa(codigo: string): boolean {
  const distintos = new Set(codigo).size;
  return distintos < 10 || /^(.)\1+$/.test(codigo) || /^(?:0123456789|abcdefghij|password|senha|codigo|teste)/i.test(codigo);
}

export function verificarConfiguracaoProducao(env: Ambiente): Achado[] {
  const a: Achado[] = [];
  const ok = (variavel: string, mensagem: string) => a.push({ nivel: "ok", variavel, mensagem });
  const aviso = (variavel: string, mensagem: string) => a.push({ nivel: "aviso", variavel, mensagem });
  const erro = (variavel: string, mensagem: string) => a.push({ nivel: "erro", variavel, mensagem });

  // --- banco
  const db = env.DATABASE_URL?.trim();
  if (!db) erro("DATABASE_URL", "ausente (use a referência ${{Postgres.DATABASE_URL}} no serviço do app).");
  else if (!/^postgres(ql)?:\/\//i.test(db)) erro("DATABASE_URL", "não é uma URL postgres://.");
  else if (/@(localhost|127\.0\.0\.1)[:/]/.test(db)) erro("DATABASE_URL", "aponta para localhost — não é o banco do Railway.");
  else if (/_test(\?|$)/.test(db.split("/").pop() ?? "")) erro("DATABASE_URL", "o nome do banco termina em _test (banco de teste).");
  else ok("DATABASE_URL", "presente e com formato postgres://.");

  // --- URL pública (base dos links de e-mail)
  const app = env.APP_URL?.trim();
  if (!app) erro("APP_URL", "ausente — em produção nenhum link de recuperação/ativação é gerado sem ela.");
  else {
    let url: URL | null = null;
    try {
      url = new URL(app);
    } catch {
      /* tratado abaixo */
    }
    if (!url) erro("APP_URL", "não é uma URL válida.");
    else if (url.protocol !== "https:") erro("APP_URL", "precisa ser https:// (os links de e-mail levam um token).");
    else if (/^(localhost|127\.)/.test(url.hostname)) erro("APP_URL", "aponta para localhost.");
    else if (app.endsWith("/") || (url.pathname !== "/" && url.pathname !== "") || url.search || url.hash)
      erro("APP_URL", "deve ser só a origem, sem barra final, caminho, query ou fragmento.");
    else ok("APP_URL", "https, sem barra final e fora de localhost.");
  }

  // --- e-mail (Resend)
  const chave = env.RESEND_API_KEY?.trim();
  if (!chave) erro("RESEND_API_KEY", "ausente — sem ela a recuperação de senha e a ativação inicial NÃO enviam e-mail.");
  else if (!/^re_[A-Za-z0-9_\-]{10,}$/.test(chave)) aviso("RESEND_API_KEY", "não tem o formato esperado (re_…); confira se copiou a chave certa.");
  else ok("RESEND_API_KEY", "presente com o formato esperado (a validade só se confirma na Resend).");

  const from = env.EMAIL_FROM?.trim();
  const dominio = dominioDoRemetente(from);
  if (!from) erro("EMAIL_FROM", "ausente.");
  else if (!dominio) erro("EMAIL_FROM", 'formato inválido; use "Nome <remetente@seudominio.com.br>".');
  else if (/(^|\.)example\.(com|org|net)$/.test(dominio)) erro("EMAIL_FROM", "usa um domínio de exemplo.");
  else if (dominio === "resend.dev") aviso("EMAIL_FROM", "resend.dev só entrega para o dono da conta Resend; use um domínio próprio verificado.");
  else ok("EMAIL_FROM", "formato válido (a verificação SPF/DKIM do domínio precisa ser conferida na Resend).");

  // --- ativação inicial
  const codigo = env.ATIVACAO_INICIAL_CODIGO;
  if (codigo === undefined || codigo === "") {
    aviso("ATIVACAO_INICIAL_CODIGO", "ausente: a ativação inicial (/configurar-conta) está DESLIGADA. Esperado depois que a conta principal existir; defina-a só durante a ativação.");
  } else if (codigo.length < CODIGO_MINIMO) {
    erro("ATIVACAO_INICIAL_CODIGO", `tem menos de ${CODIGO_MINIMO} caracteres — o servidor a trata como desligada.`);
  } else if (entropiaBaixa(codigo)) {
    erro("ATIVACAO_INICIAL_CODIGO", "parece previsível (poucos caracteres distintos ou padrão conhecido); gere um valor aleatório.");
  } else {
    ok("ATIVACAO_INICIAL_CODIGO", `presente com ${codigo.length} caracteres. Lembre-se de REMOVÊ-LA depois da ativação.`);
  }

  // --- o que NÃO pode existir em produção
  for (const proibida of ["ADMIN_SENHA", "TEST_DATABASE_URL"]) {
    if (env[proibida]) erro(proibida, "não deve existir no serviço de produção (remova).");
    else ok(proibida, "ausente, como deve ser.");
  }
  // NODE_ENV NÃO deve ser cadastrada como variável do serviço: o Next já usa "production" em `next build`/`next start`,
  // e se o instalador a enxergar durante `npm ci`, pula as devDependencies (tailwind, typescript...) e o build quebra
  // (reproduzido em simulação Linux: "Build failed because of webpack errors").
  if (env.NODE_ENV === "production") aviso("NODE_ENV", "definida como variável do serviço: remova-a (o Next a define sozinho). Com ela, o instalador pode pular as devDependencies e o build falhar.");

  const horas = env.NEXT_PUBLIC_SESSAO_OFFLINE_HORAS;
  if (horas !== undefined && horas !== "" && !(Number(horas) > 0 && Number(horas) <= 168))
    erro("NEXT_PUBLIC_SESSAO_OFFLINE_HORAS", "deve ser um número de horas entre 1 e 168 (embutido no build).");

  return a;
}

/** Verificação opcional, SOMENTE LEITURA, na API da Resend: lista os domínios e confere o status do remetente. */
export async function verificarDominioNaResend(
  env: Ambiente,
  buscar: typeof fetch = fetch
): Promise<Achado> {
  const dominio = dominioDoRemetente(env.EMAIL_FROM);
  if (!env.RESEND_API_KEY || !dominio) return { nivel: "erro", variavel: "RESEND", mensagem: "RESEND_API_KEY e EMAIL_FROM válidos são necessários para consultar a Resend." };
  try {
    const r = await buscar("https://api.resend.com/domains", {
      method: "GET",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (r.status === 401 || r.status === 403) {
      return { nivel: "aviso", variavel: "RESEND_API_KEY", mensagem: `a API respondeu HTTP ${r.status}: chave inválida, ou com permissão só de envio (que não lista domínios). Isso não prova que o envio falhará.` };
    }
    if (!r.ok) return { nivel: "aviso", variavel: "RESEND", mensagem: `a API respondeu HTTP ${r.status}.` };
    const corpo = (await r.json()) as { data?: { name: string; status: string }[] };
    const d = corpo.data?.find((x) => x.name.toLowerCase() === dominio);
    if (!d) return { nivel: "erro", variavel: "EMAIL_FROM", mensagem: `o domínio ${dominio} não consta na conta Resend desta chave.` };
    return d.status === "verified"
      ? { nivel: "ok", variavel: "EMAIL_FROM", mensagem: `domínio ${dominio} VERIFICADO na Resend.` }
      : { nivel: "erro", variavel: "EMAIL_FROM", mensagem: `domínio ${dominio} com status "${d.status}" na Resend (esperado: verified).` };
  } catch (e) {
    return { nivel: "aviso", variavel: "RESEND", mensagem: `não foi possível consultar a Resend (${(e as Error).name}).` };
  }
}

/** Verificação opcional de DNS (DKIM da Resend) do domínio do remetente. */
export async function verificarDnsDoRemetente(
  env: Ambiente,
  resolverTxt: (nome: string) => Promise<string[][]>
): Promise<Achado> {
  const dominio = dominioDoRemetente(env.EMAIL_FROM);
  if (!dominio) return { nivel: "erro", variavel: "EMAIL_FROM", mensagem: "sem domínio de remetente para conferir no DNS." };
  try {
    const registros = (await resolverTxt(`resend._domainkey.${dominio}`)).map((p) => p.join(""));
    return registros.some((r) => /p=/.test(r))
      ? { nivel: "ok", variavel: "EMAIL_FROM", mensagem: `DKIM da Resend publicado em resend._domainkey.${dominio}.` }
      : { nivel: "aviso", variavel: "EMAIL_FROM", mensagem: `registro DKIM não encontrado em resend._domainkey.${dominio}.` };
  } catch {
    return { nivel: "aviso", variavel: "EMAIL_FROM", mensagem: `sem registro DKIM em resend._domainkey.${dominio} (ou DNS indisponível). Se a Resend usa outro seletor, confirme no painel.` };
  }
}

export function resumo(achados: Achado[]): { erros: number; avisos: number } {
  return { erros: achados.filter((x) => x.nivel === "erro").length, avisos: achados.filter((x) => x.nivel === "aviso").length };
}
