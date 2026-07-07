/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: "#1E40AF", light: "#3B82F6" },
        secondary: "#0F766E",
        accent: "#F59E0B",
      },
    },
  },
  plugins: [],
};
