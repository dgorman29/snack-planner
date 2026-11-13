/* Colour themes. Each theme sets the base palette tokens that tailwind.config.js
   reads through CSS variables (`rgb(var(--ink) / <alpha-value>)`), so switching
   is instant and needs no re-render. The pastel tokens (peach, butter, mint,
   mintink, ice, lilac) stay the same in every theme: they colour shopping
   sections and ratings, and the rating text colours are tuned to them.

   The choice is a per-device preference, so it lives in localStorage. */

const KEY_THEME = "snackplan:theme:v1";

const SHARED = {
  peach: "#FFD3C2",
  butter: "#FFE7A3",
  mint: "#CDEBD6",
  mintink: "#2D4A3A",
  ice: "#D5E7F2",
  lilac: "#E6DCF2",
  tomato: "#F06B5B", // fridge leftovers going bad (72 h+); red in every theme
};

export const THEMES = [
  {
    id: "peach", name: "Peach Jam",
    colors: { blush: "#FFF0EA", ink: "#3D2B2B", muted: "#7A5A58", line: "#FFE3D8", dim: "#B98E88", berry: "#C2385B" },
  },
  {
    id: "mint", name: "Mint Garden",
    colors: { blush: "#EEF7F0", ink: "#263A2F", muted: "#4F6A5C", line: "#D8EDDF", dim: "#8FB09C", berry: "#2F7A55" },
  },
  {
    id: "blueberry", name: "Blueberry",
    colors: { blush: "#EEF3FB", ink: "#26304A", muted: "#525C7A", line: "#DCE6F5", dim: "#8D9CBC", berry: "#3E5BB8" },
  },
  {
    id: "lemon", name: "Lemon",
    colors: { blush: "#FFF8E1", ink: "#3A3020", muted: "#6B5E44", line: "#FCEDC0", dim: "#BCA77A", berry: "#B0501A" },
  },
  {
    id: "lilac", name: "Lilac",
    colors: { blush: "#F5F0FB", ink: "#33284A", muted: "#62557A", line: "#EAE0F5", dim: "#A898C0", berry: "#7B3FA8" },
  },
];

export const DEFAULT_THEME = "peach";

const triple = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
};

export function loadTheme() {
  try {
    const id = localStorage.getItem(KEY_THEME);
    if (THEMES.some((t) => t.id === id)) return id;
  } catch {}
  return DEFAULT_THEME;
}

export function applyTheme(id) {
  const theme = THEMES.find((t) => t.id === id) || THEMES[0];
  const root = document.documentElement;
  for (const [name, hex] of Object.entries({ ...SHARED, ...theme.colors })) {
    root.style.setProperty(`--${name}`, triple(hex));
  }
  root.dataset.theme = theme.id;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme.colors.blush);
}

export function saveTheme(id) {
  applyTheme(id);
  try { localStorage.setItem(KEY_THEME, id); } catch {}
}
