/**
 * Sonda de IP: descobre QUAL IP o ambiente (Railway) realmente entrega ao app e se cabeçalhos forjados pelo
 * cliente são ignorados. Não presume que `x-real-ip` esteja correto — mede.
 *
 *   DATABASE_URL="<DATABASE_PUBLIC_URL>" npm run sonda:ip -- --url https://SEU-APP --meu-ip 203.0.113.10
 *
 *  --url      origem pública do app já publicado (https). Para testar localmente: http://localhost:3100
 *  --meu-ip   o IP público de ONDE você roda este script (veja em qualquer "qual é o meu IP").
 *  DATABASE_URL  só é usada para LER (SELECT em limites_tentativa); nada é alterado ou apagado.
 *
 * Como funciona: faz 3 tentativas de login com e-mails FICTÍCIOS e senha errada (não afeta a conta real, só o
 * contador de IP, que expira sozinho): (A) com X-Real-IP e X-Forwarded-For forjados, (B) só com X-Forwarded-For
 * forjado, (C) sem cabeçalho nenhum. Depois lê as chaves `login:ip:*` que o app gravou e compara com os IPs
 * forjados e com o seu. O veredito sai em texto; o código de saída é 0 só se tudo estiver correto.
 *
 * NÃO use um e-mail real nem rode em loop. Cada execução soma 3 falhas ao contador do SEU IP (limite 20/15 min).
 */
import { randomBytes } from "node:crypto";
import { normalizarIp } from "../lib/auth/ip";
import { prisma } from "../services/prisma/client";

const arg = (nome: string) => {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const FORJADO_A_REAL = "203.0.113.91"; // TEST-NET-3 (documentação): nunca é um cliente real
const FORJADO_A_XFF = "203.0.113.92";
const FORJADO_B_XFF = "203.0.113.93";

async function idDaAcaoDeLogin(base: string): Promise<string> {
  const html = await (await fetch(`${base}/login`)).text();
  const scripts = [...html.matchAll(/src="(\/_next\/static\/[^"]+\.js)"/g)].map((m) => m[1]);
  for (const s of new Set(scripts)) {
    const js = await (await fetch(`${base}${s}`)).text();
    const m = /createServerReference\)?\(\s*"([0-9a-f]{40,})"[^)]*?"loginAction"\s*\)/.exec(js);
    if (m) return m[1];
  }
  throw new Error("Não achei o identificador da ação de login nos scripts da página /login.");
}

async function tentarLogin(base: string, idAcao: string, cabecalhos: Record<string, string>) {
  const email = `sonda-ip-${randomBytes(6).toString("hex")}@example.invalid`;
  const r = await fetch(`${base}/login`, {
    method: "POST",
    headers: { "Next-Action": idAcao, "Content-Type": "text/plain;charset=UTF-8", ...cabecalhos },
    body: JSON.stringify([{ email, senha: "senha-errada-da-sonda-1" }]),
  });
  return r.status;
}

async function principal() {
  const url = arg("url")?.replace(/\/+$/, "");
  const meuIp = arg("meu-ip");
  if (!url || !meuIp) throw new Error("Use: --url <origem do app> --meu-ip <seu IP público>");
  if (!process.env.DATABASE_URL) throw new Error("Defina DATABASE_URL (somente leitura de limites_tentativa).");
  if (!/^https:\/\//.test(url) && !/^http:\/\/localhost/.test(url)) throw new Error("--url deve ser https:// (ou http://localhost para ensaio).");

  const inicio = new Date(Date.now() - 2000);
  const id = await idDaAcaoDeLogin(url);
  const status = [
    await tentarLogin(url, id, { "X-Real-IP": FORJADO_A_REAL, "X-Forwarded-For": FORJADO_A_XFF }),
    await tentarLogin(url, id, { "X-Forwarded-For": FORJADO_B_XFF }),
    await tentarLogin(url, id, {}),
  ];
  console.log(`Respostas HTTP das 3 tentativas: ${status.join(", ")}`);
  await new Promise((r) => setTimeout(r, 1500));

  const linhas = await prisma.limiteTentativa.findMany({
    where: { chave: { startsWith: "login:ip:" }, atualizado_em: { gte: inicio } },
    select: { chave: true },
  });
  const vistos = new Set(linhas.map((l) => l.chave.replace("login:ip:", "")));
  const esperado = normalizarIp(meuIp);
  const forjados = [FORJADO_A_REAL, FORJADO_A_XFF, FORJADO_B_XFF].map(normalizarIp);

  console.log(`IP que o app registrou nesta sonda: ${[...vistos].join(", ") || "(nenhum)"}`);
  console.log(`IP esperado (o seu, normalizado):    ${esperado}`);

  let erros = 0;
  const forjadoAceito = forjados.filter((f) => vistos.has(f));
  if (forjadoAceito.length > 0) {
    erros++;
    console.log(`INSEGURO  O app aceitou cabeçalho forjado pelo cliente (${forjadoAceito.join(", ")}). O limite por IP pode ser contornado: NÃO publique assim; ajuste ipDoCliente() à infraestrutura.`);
  } else {
    console.log("OK        Nenhum dos IPs forjados (X-Real-IP / X-Forwarded-For enviados pelo cliente) foi usado.");
  }
  if (vistos.has(esperado)) {
    console.log("OK        O app enxerga o IP real de quem chama (o seu).");
  } else if (vistos.size > 0 && forjadoAceito.length === 0) {
    erros++;
    console.log(`ATENÇÃO   O app NÃO enxerga o seu IP: viu ${[...vistos].join(", ")}. Se for o IP interno do proxy, TODOS os usuários dividem um único contador (um atacante trava o login de todos). Defina qual cabeçalho do proxy carrega o IP do cliente e ajuste ipDoCliente().`);
  } else if (vistos.size === 0) {
    erros++;
    console.log('ATENÇÃO   Nenhuma chave nova em limites_tentativa: as tentativas não chegaram ao app, ou DATABASE_URL aponta para outro banco, ou a ação de login não foi encontrada.');
  }
  console.log(
    erros === 0
      ? "\nRESULTADO: APROVADO para esta rede. Isto vale para o IP de ONDE você rodou; repita --meu-ip a partir de OUTRA rede (ex.: dados móveis) e só libere se as duas aprovarem, com IPs registrados diferentes."
      : "\nRESULTADO: BLOQUEAR A LIBERAÇÃO. Não abra o sistema para uso até corrigir e repetir a sonda no ambiente publicado (testes locais não substituem isto)."
  );
  process.exitCode = erros === 0 ? 0 : 1;
}

principal()
  .catch((e) => {
    console.error(`Erro: ${(e as Error).message}`);
    process.exitCode = 2;
  })
  .finally(() => prisma.$disconnect());
