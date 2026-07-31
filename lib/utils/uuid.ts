/**
 * `crypto.randomUUID()` só existe em "contexto seguro" (HTTPS ou
 * localhost). Acessar o app por IP da rede local em HTTP — o cenário
 * real do Terminal Emergencial (celular na mesma Wi-Fi do posto) — é
 * um contexto NÃO seguro, então o navegador remove esse método mesmo
 * com `crypto` continuando presente. Usado em vários pontos do
 * Offline First (ids de venda, item de fila, eventos de auditoria),
 * então centralizado aqui uma vez só, com fallback em camadas:
 *
 * 1. crypto.randomUUID() — quando disponível (produção em HTTPS, ou
 *    localhost, ou o lado do servidor no Node, onde sempre existe).
 * 2. crypto.getRandomValues() — ainda disponível em contexto não
 *    seguro na maioria dos navegadores; monta um UUID v4 manualmente.
 * 3. Math.random() — último recurso, só para nunca quebrar a
 *    aplicação; aceitável aqui porque estes ids são apenas
 *    identificadores de registro (não segredos, não chaves de
 *    segurança — PIN continua com hash bcrypt, isso não muda).
 */
export function gerarUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // versão 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variante RFC 4122
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  // eslint-disable-next-line no-console
  console.warn("gerarUuid: usando fallback Math.random — nem crypto.randomUUID nem crypto.getRandomValues disponíveis.");
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}