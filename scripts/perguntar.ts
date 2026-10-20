import { createInterface } from "node:readline";
import { Writable } from "node:stream";

interface Terminal {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
}

/**
 * Faz uma pergunta no terminal e devolve a resposta. Com `oculto`, o que se digita não é ecoado.
 *
 * A pergunta é entregue ao próprio `readline` (`rl.question(pergunta)`): ele redesenha a linha
 * (ESC[1G ESC[0J) ANTES de escrevê-la. Escrever a pergunta por fora e chamar `question("")` fazia o
 * redesenho apagar a pergunta no terminal real, que parecia travado. O eco só é silenciado depois
 * de a pergunta ter sido escrita.
 */
export function perguntar(
  pergunta: string,
  oculto = false,
  terminal: Terminal = { input: process.stdin, output: process.stdout }
): Promise<string> {
  let mudo = false;
  const saida = new Writable({
    write(chunk, _enc, cb) {
      if (!mudo) terminal.output.write(chunk);
      cb();
    },
  });
  const rl = createInterface({ input: terminal.input, output: saida, terminal: true });
  return new Promise((resolver) => {
    rl.question(pergunta, (resposta) => {
      rl.close();
      if (oculto) terminal.output.write("\n");
      resolver(resposta);
    });
    mudo = oculto;
  });
}
