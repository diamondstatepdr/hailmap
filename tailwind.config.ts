import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        app: "var(--bg)",
        panel: "var(--panel)",
        ink: "var(--text)",
        muted: "var(--muted)",
        line: "var(--border)",
        accent: "var(--accent)",
        accentink: "var(--accent-ink)",
      },
      boxShadow: {
        sheet: "0 -8px 30px rgba(15, 23, 42, 0.12)",
      },
    },
  },
  plugins: [],
};

export default config;
