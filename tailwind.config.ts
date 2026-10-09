import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "Inter", "Segoe UI", "sans-serif"],
      },
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
        sheet: "0 -12px 40px rgba(15, 23, 42, 0.14)",
        float: "0 12px 32px rgba(16, 36, 56, 0.12)",
      },
    },
  },
  plugins: [],
};

export default config;
