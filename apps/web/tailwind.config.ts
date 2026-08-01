import type { Config } from "tailwindcss";

// Tokens from .ai/knowledge/technical/frontend/design-system.md — source of truth, don't duplicate values elsewhere.
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0A0A0F",
        surface: "#111118",
        surface2: "#18181F",
        surface3: "#1F1F28",
        accent: "#22D3A5",
        accent2: "#3B82F6",
        border: "rgba(255,255,255,0.07)",
        border2: "rgba(255,255,255,0.12)",
        text: "#F0F0F5",
        text2: "#9999AA",
        text3: "#55556A",
        green: "#34D399",
        yellow: "#FBBF24",
        red: "#F87171",
        blue: "#60A5FA",
        purple: "#A78BFA",
      },
      fontFamily: {
        display: ["Syne", "sans-serif"],
        body: ["DM Sans", "sans-serif"],
        mono: ["DM Mono", "monospace"],
      },
      borderRadius: {
        card: "12px", // rounded-xl
        button: "8px", // rounded-lg
      },
    },
  },
  plugins: [],
};

export default config;
