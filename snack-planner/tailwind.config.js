/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      // Peach Jam palette. Change a value here and the whole app follows.
      colors: {
        blush: "#FFF0EA",   // page background
        ink: "#3D2B2B",     // text and outlines
        muted: "#7A5A58",   // secondary text
        line: "#FFE3D8",    // soft dividers
        dim: "#B98E88",     // dashed "add" borders
        peach: "#FFD3C2",
        butter: "#FFE7A3",
        mint: "#CDEBD6",
        mintink: "#2D4A3A", // text on mint
        ice: "#D5E7F2",
        lilac: "#E6DCF2",
        berry: "#C2385B",   // primary accent
      },
      fontFamily: {
        sans: ["Nunito", "system-ui", "sans-serif"],
        display: ["Fredoka", "Nunito", "system-ui", "sans-serif"],
      },
      boxShadow: {
        sticker: "3px 3px 0 #3D2B2B",
        "sticker-sm": "2px 2px 0 #3D2B2B",
        "sticker-lg": "4px 4px 0 #3D2B2B",
      },
    },
  },
  plugins: [],
};
