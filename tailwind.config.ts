import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        cyber: {
          dark: "#09090b",
          panel: "#0f172a",
          border: "#1e293b",
          emerald: "#10b981",
          amber: "#f59e0b",
          violet: "#8b5cf6",
        },
      },
    },
  },
  plugins: [],
};
export default config;
