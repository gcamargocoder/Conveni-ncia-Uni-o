import type { NextConfig } from "next";

const emProducao = process.env.NODE_ENV === "production";

const cabecalhosGerais = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  ...(emProducao ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
];

const nextConfig: NextConfig = {
  // Permite acessar o servidor de desenvolvimento pelo IP da rede local
  // — necessário para testar em outro aparelho (ex: celular) na mesma
  // Wi-Fi do posto, o cenário real do Terminal Emergencial.
  //
  // Atenção: se o IP da sua máquina na rede mudar (ex: reiniciar o
  // roteador), pode ser preciso atualizar esse valor. Veja o IP atual
  // na mensagem do "npm run dev" (linha "Network: http://...").
  allowedDevOrigins: ["172.24.48.1"],

  // Módulo nativo (Argon2): não pode ser empacotado pelo bundler.
  serverExternalPackages: ["@node-rs/argon2"],

  async headers() {
    return [
      { source: "/:path*", headers: cabecalhosGerais },
      // Telas de autenticação: nunca em cache; o link de redefinição leva um
      // token na URL, então também não pode vazar via cabeçalho Referer.
      {
        source: "/(login|recuperar-senha)",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
      {
        source: "/(redefinir-senha|ativar-conta|configurar-conta)",
        headers: [
          { key: "Cache-Control", value: "no-store" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
};

export default nextConfig;
