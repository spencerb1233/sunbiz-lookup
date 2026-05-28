import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["'Instrument Serif'", "Georgia", "serif"],
        sans: ["'IBM Plex Sans'", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono'", "ui-monospace", "monospace"],
      },
      colors: {
        paper: "#FAF7F1",
        ink: "#16202E",
        rule: "#D9D2C2",
        accent: "#B8552E",
        muted: "#6B6457",
      },
    },
  },
  plugins: [],
};
export default config;
