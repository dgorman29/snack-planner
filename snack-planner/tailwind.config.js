/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      // Colours come from CSS variables set by src/themes.js, so the theme
      // picker can swap the whole palette at runtime. Edit themes there.
      colors: {
        blush: "rgb(var(--blush) / <alpha-value>)",
        ink: "rgb(var(--ink) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
        line: "rgb(var(--line) / <alpha-value>)",
        dim: "rgb(var(--dim) / <alpha-value>)",
        peach: "rgb(var(--peach) / <alpha-value>)",
        butter: "rgb(var(--butter) / <alpha-value>)",
        mint: "rgb(var(--mint) / <alpha-value>)",
        mintink: "rgb(var(--mintink) / <alpha-value>)",
        ice: "rgb(var(--ice) / <alpha-value>)",
        lilac: "rgb(var(--lilac) / <alpha-value>)",
        berry: "rgb(var(--berry) / <alpha-value>)",
        tomato: "rgb(var(--tomato) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["Nunito", "system-ui", "sans-serif"],
        display: ["Fredoka", "Nunito", "system-ui", "sans-serif"],
      },
      boxShadow: {
        sticker: "3px 3px 0 rgb(var(--ink))",
        "sticker-sm": "2px 2px 0 rgb(var(--ink))",
        "sticker-lg": "4px 4px 0 rgb(var(--ink))",
      },
    },
  },
  plugins: [],
};
