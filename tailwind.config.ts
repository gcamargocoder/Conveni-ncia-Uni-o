import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Azul corporativo (tema claro GC-Sys): 700 = #1E40AF (primário), 600 = #2563EB.
        brand: {
          50: "#EFF6FF",
          100: "#DBEAFE",
          200: "#BFDBFE",
          600: "#2563EB",
          700: "#1E40AF",
          900: "#1E3A8A",
        },
        // Laranja da chama/faixa da logo — só para destaques estratégicos
        // pontuais (nunca como cor de fundo extensa).
        "brand-accent": {
          DEFAULT: "#F28A29",
          50: "#FEF3E7",
          600: "#D9720F",
        },
        // Paleta escura (GC-Sys): ainda não usada pelos componentes.
        surface: {
          DEFAULT: "#0d0d0d",
          elevated: "#171717",
          border: "#1f1f1f",
        },
        "brand-blue": {
          DEFAULT: "#2563eb",
          hover: "#1d4ed8",
        },
        "brand-orange": {
          DEFAULT: "#f97316",
        },
        matrix: "#10b981",
        // Cores semânticas — cada uma com um único propósito, nunca
        // usadas decorativamente (evita "excesso de cores").
        success: { 50: "#F0FDF4", 600: "#16A34A", 700: "#15803D" },
        danger: { 50: "#FEF2F2", 600: "#DC2626", 700: "#B91C1C" },
        warning: { 50: "#FFFBEB", 600: "#D97706", 700: "#B45309" },
      },
      fontFamily: {
        sans: ["var(--font-manrope)", "system-ui", "sans-serif"],
      },
      boxShadow: {
        // Elevação sutil e consistente — nunca sombra pesada/genérica de template.
        card: "0 1px 2px 0 rgb(15 23 42 / 0.04), 0 1px 3px 0 rgb(15 23 42 / 0.06)",
        elevated: "0 4px 6px -1px rgb(15 23 42 / 0.08), 0 10px 15px -3px rgb(15 23 42 / 0.08)",
      },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "slide-up": { from: { opacity: "0", transform: "translateY(4px)" }, to: { opacity: "1", transform: "translateY(0)" } },
      },
      animation: {
        "fade-in": "fade-in 150ms ease-out",
        "slide-up": "slide-up 150ms ease-out",
      },
    },
  },
  plugins: [],
};

export default config;