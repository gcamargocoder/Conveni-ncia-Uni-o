/**
 * Confere as variáveis de ambiente de PRODUÇÃO sem imprimir nenhum valor.
 *
 *   npm run verificar:producao                 # confere o ambiente atual do processo
 *   npm run verificar:producao -- --resend     # + consulta SOMENTE-LEITURA à API da Resend (status do domínio)
 *   npm run verificar:producao -- --dns        # + DKIM do domínio do remetente no DNS
 *
 * Para conferir as variáveis do Railway sem salvá-las em arquivo: `railway run npm run verificar:producao`
 * (a CLI do Railway injeta as variáveis só neste processo) ou cole-as na sessão do terminal. Nunca envia e-mail.
 */
import { resolveTxt } from "node:dns/promises";
import { verificarConfiguracaoProducao, verificarDominioNaResend, verificarDnsDoRemetente, resumo, type Achado } from "../lib/config/verificar-producao";

const SIMBOLO = { ok: "OK   ", aviso: "AVISO", erro: "ERRO " } as const;

async function principal() {
  const achados: Achado[] = verificarConfiguracaoProducao(process.env);
  if (process.argv.includes("--resend")) achados.push(await verificarDominioNaResend(process.env));
  if (process.argv.includes("--dns")) achados.push(await verificarDnsDoRemetente(process.env, resolveTxt));

  for (const x of achados) console.log(`${SIMBOLO[x.nivel]}  ${x.variavel.padEnd(34)} ${x.mensagem}`);
  const { erros, avisos } = resumo(achados);
  console.log(`\n${erros} erro(s), ${avisos} aviso(s). ${erros === 0 ? "Configuração sem erros." : "Corrija os erros antes de publicar."}`);
  console.log("Isto NÃO prova que o e-mail chega: o teste de entrega real é um passo manual do roteiro (PRE_PUBLICACAO_RAILWAY.md).");
  process.exitCode = erros === 0 ? 0 : 1;
}

principal().catch((e) => {
  console.error(`Falha ao verificar: ${(e as Error).name}`);
  process.exitCode = 2;
});
