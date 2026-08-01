import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Conveniência União",
    short_name: "Conveniência União",
    description: "Sistema de gestão de conveniência do Auto Posto União — vendas, estoque e sincronização, com funcionamento offline.",
    start_url: "/pdv",
    id: "/pdv",
    display: "standalone",
    display_override: ["window-controls-overlay", "standalone", "browser"],
    orientation: "portrait-primary",
    theme_color: "#213E8C",
    background_color: "#213E8C",
    categories: ["business", "productivity", "utilities"],
    lang: "pt-BR",
    icons: [
      { src: "/icons/icon-16.png", sizes: "16x16", type: "image/png" },
      { src: "/icons/icon-32.png", sizes: "32x32", type: "image/png" },
      { src: "/icons/icon-48.png", sizes: "48x48", type: "image/png" },
      { src: "/icons/icon-72.png", sizes: "72x72", type: "image/png" },
      { src: "/icons/icon-96.png", sizes: "96x96", type: "image/png" },
      { src: "/icons/icon-128.png", sizes: "128x128", type: "image/png" },
      { src: "/icons/icon-144.png", sizes: "144x144", type: "image/png" },
      { src: "/icons/icon-152.png", sizes: "152x152", type: "image/png" },
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-384.png", sizes: "384x384", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      {
        name: "Nova venda",
        short_name: "Venda",
        description: "Abrir o PDV para realizar uma venda",
        url: "/pdv",
        icons: [{ src: "/icons/shortcut-venda.png", sizes: "96x96", type: "image/png" }],
      },
      {
        name: "Estoque",
        short_name: "Estoque",
        description: "Ver e ajustar o estoque",
        url: "/estoque",
        icons: [{ src: "/icons/shortcut-estoque.png", sizes: "96x96", type: "image/png" }],
      },
    ],
  };
}