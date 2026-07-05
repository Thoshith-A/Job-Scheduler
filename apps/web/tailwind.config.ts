import type { Config } from "tailwindcss";

/**
 * Dark studio theme for the Flux control room.
 * Warm amber primary + cyan secondary accents on near-black glossy surfaces.
 * Job-status colors are a reserved "status" palette (always paired with labels).
 */
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./hooks/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Surfaces
        void: "#08090b",
        studio: "#0d0f13",
        panel: "#12151b",
        edge: "rgba(255,255,255,0.08)",
        // Accents
        amber: {
          DEFAULT: "#f5a524",
          soft: "#ffbf5c",
          deep: "#c77f10",
        },
        cyan: {
          DEFAULT: "#22d3ee",
          soft: "#67e8f9",
        },
        // Text
        ink: "#e8eaf0",
        "ink-muted": "#9aa2b1",
        "ink-faint": "#626a7a",
        // Job status palette (status role: always shown with a label)
        status: {
          scheduled: "#60a5fa",
          queued: "#22d3ee",
          claimed: "#a78bfa",
          running: "#fbbf24",
          completed: "#34d399",
          failed: "#f87171",
          dead: "#e11d48",
          canceled: "#94a3b8",
        },
        // Health scale
        good: "#34d399",
        warn: "#fbbf24",
        crit: "#f87171",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      boxShadow: {
        glow: "0 0 40px -8px rgba(245,165,36,0.35)",
        "glow-cyan": "0 0 40px -8px rgba(34,211,238,0.35)",
        panel: "0 20px 60px -20px rgba(0,0,0,0.8)",
      },
      backgroundImage: {
        "studio-radial":
          "radial-gradient(1200px 600px at 70% -10%, rgba(245,165,36,0.08), transparent 60%), radial-gradient(900px 600px at 10% 10%, rgba(34,211,238,0.06), transparent 55%)",
        "glass":
          "linear-gradient(160deg, rgba(255,255,255,0.05), rgba(255,255,255,0.01))",
      },
      keyframes: {
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.5" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
      },
      animation: {
        "pulse-soft": "pulse-soft 2s cubic-bezier(0.4,0,0.6,1) infinite",
        shimmer: "shimmer 1.6s infinite",
      },
    },
  },
  plugins: [],
};

export default config;
