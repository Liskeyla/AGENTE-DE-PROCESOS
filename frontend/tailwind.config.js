/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "#1E3A5F",
          light: "#2F5A8A",
          muted: "#E8EEF5",
        },
        secondary: {
          DEFAULT: "#E08A2E",
          muted: "#FBF0E0",
        },
        surface: {
          DEFAULT: "#F4F6F9",
          card: "#FFFFFF",
        },
        ink: {
          DEFAULT: "#1F2A37",
          muted: "#5B6B7C",
          faint: "#8A96A3",
        },
        success: { DEFAULT: "#2F9E6F", muted: "#E8F7F0" },
        warning: { DEFAULT: "#E08A2E", muted: "#FBF0E0" },
        danger: { DEFAULT: "#C53030", muted: "#FEECEC" },
      },
      boxShadow: {
        card: "0 1px 3px rgba(30, 58, 95, 0.06), 0 1px 2px rgba(30, 58, 95, 0.04)",
        elevated: "0 4px 16px rgba(30, 58, 95, 0.10)",
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
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(224, 138, 46, 0.35)" },
          "50%": { boxShadow: "0 0 0 10px rgba(224, 138, 46, 0)" },
        },
      },
    },
  },
  plugins: [],
};
