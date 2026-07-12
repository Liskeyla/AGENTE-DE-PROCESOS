/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "#1E3A5F",
          light: "#4F8EF7",
          muted: "#E8EEF5",
        },
        secondary: {
          DEFAULT: "#4F8EF7",
          muted: "#EBF2FE",
        },
        surface: {
          DEFAULT: "#F5F7FA",
          card: "#FFFFFF",
        },
        ink: {
          DEFAULT: "#2D3748",
          muted: "#64748B",
          faint: "#94A3B8",
        },
        success: { DEFAULT: "#2F9E6F", muted: "#E8F7F0" },
        warning: { DEFAULT: "#E67E22", muted: "#FEF3E8" },
        danger: { DEFAULT: "#C53030", muted: "#FEECEC" },
      },
      boxShadow: {
        card: "0 1px 3px rgba(30, 58, 95, 0.06), 0 1px 2px rgba(30, 58, 95, 0.04)",
        elevated: "0 4px 16px rgba(30, 58, 95, 0.08)",
      },
      animation: {
        "fade-in": "fadeIn 0.35s ease-out",
        "slide-up": "slideUp 0.35s ease-out",
        pulseSoft: "pulseSoft 1.5s ease-in-out infinite",
      },
      keyframes: {
        fadeIn: { from: { opacity: "0" }, to: { opacity: "1" } },
        slideUp: { from: { opacity: "0", transform: "translateY(8px)" }, to: { opacity: "1", transform: "translateY(0)" } },
        pulseSoft: {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(79, 142, 247, 0.35)" },
          "50%": { boxShadow: "0 0 0 10px rgba(79, 142, 247, 0)" },
        },
      },
    },
  },
  plugins: [],
};
