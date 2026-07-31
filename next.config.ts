import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Permite acessar o servidor de desenvolvimento pelo IP da rede local
  // — necessário para testar em outro aparelho (ex: celular) na mesma
  // Wi-Fi do posto, o cenário real do Terminal Emergencial.
  //
  // Atenção: se o IP da sua máquina na rede mudar (ex: reiniciar o
  // roteador), pode ser preciso atualizar esse valor. Veja o IP atual
  // na mensagem do "npm run dev" (linha "Network: http://...").
  allowedDevOrigins: ["172.24.48.1"],
};

export default nextConfig;