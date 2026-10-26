import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  Carrot, ShoppingBasket, ClipboardCheck, BookMarked, TrendingUp,
  Plus, Check, X, Link2, Loader2, Copy, Search, RefreshCw,
  ChevronDown, ChevronRight, Trash2, Sparkles, Clock,
} from "lucide-react";
import { supabase, supabaseConfigured } from "./lib/supabaseClient";

/* ---------------------------------------------------------------- storage */
/* Same three keys as the original Artifact version (window.storage), now
   backed by a single `kv_store(key text primary key, value jsonb)` table
   in Supabase instead. */

const KEY_CORE = "snackplan:core:v1";     // library + archived weeks + exposure counts
const KEY_WEEK = "snackplan:week:v1";     // this week: suggestions, picks, prepped, list state
const KEY_HAVE = "snackplan:pantry:v1";   // ingredients we always have at home

async function loadKey(key, fallback) {
  try {
    if (!supabase) return fallback;
    const { data, error } = await supabase.from("kv_store").select("value").eq("key", key).maybeSingle();
    if (error || !data) return fallback;
    return data.value == null ? fallback : data.value;
  } catch (e) {
    return fallback;
  }
}

async function saveKey(key, value) {
  try {
    if (!supabase) return false;
    const { error } = await supabase.from("kv_store").upsert({ key, value, updated_at: new Date().toISOString() });
    if (error) console.error("save failed", key, error);
    return !error;
  } catch (e) {
    console.error("save failed", key, e);
    return false;
  }
}

/* ------------------------------------------------------------------ dates */

function weekStartOf(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const dow = (x.getDay() + 6) % 7; // Monday = 0
  x.setDate(x.getDate() - dow);
  return x.toISOString().slice(0, 10);
}

function prettyWeek(id) {
  const d = new Date(id + "T12:00:00");
  const end = new Date(d);
  end.setDate(end.getDate() + 6);
  const f = (x) => x.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${f(d)} – ${f(end)}`;
}

function weeksBetween(aId, bId) {
  if (!aId || !bId) return 999;
  const a = new Date(aId + "T12:00:00");
  const b = new Date(bId + "T12:00:00");
  return Math.round((b - a) / (7 * 86400000));
}

/* ------------------------------------------------------------ vocabulary */

const TIERS = {
  grab: { label: "Grab and go", hint: "no prep" },
  assembly: { label: "2–3 min", hint: "quick assembly" },
  batch: { label: "Weekend batch", hint: "30–45 min" },
};
const TIER_ORDER = ["grab", "assembly", "batch"];

const SECTIONS = ["produce", "dairy", "pantry", "frozen", "other"];
const SECTION_LABEL = {
  produce: "Produce", dairy: "Dairy", pantry: "Pantry", frozen: "Frozen", other: "Other",
};

const VERDICTS = {
  loved: { label: "Loved it", score: 3, tone: "#2f7d55" },
  some: { label: "Ate some", score: 2, tone: "#b1791f" },
  refused: { label: "Refused", score: 1, tone: "#9a5560" },
};

// Exposures it can take before a new vegetable lands. Drives the tally meter.
const EXPOSURE_TARGET = 10;

/* Vegetables get a stable colour so the same one is recognisable at a glance
   across suggestions, the shopping list and the history tally. */
const VEG_PALETTE = [
  "#5f8f3e", "#d1762f", "#7a5ea8", "#3f8e8a", "#c0483f",
  "#9c8420", "#4a76b8", "#a8437a", "#6b7f2f", "#c25e1f",
];
function vegColor(name) {
  const s = (name || "veg").toLowerCase();
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 100000;
  return VEG_PALETTE[h % VEG_PALETTE.length];
}

/* ---------------------------------------------------------------- seeding */

let seq = 0;
const newId = () => `s${Date.now().toString(36)}${(seq++).toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

const ing = (name, qty, unit, section) => ({ name, qty, unit: unit || "", section: section || "other" });

function mkSnack(title, vegetable, tier, prepMinutes, ingredients, steps, extra = {}) {
  return {
    id: newId(), title, vegetable, tier, prepMinutes, ingredients, steps,
    source: "seed", url: "", ratings: [], lastMadeWeek: null, ...extra,
  };
}

function seedLibrary() {
  return [
    mkSnack("Cucumber coins with whipped cottage cheese", "cucumber", "assembly", 5, [
      ing("English cucumber", 1, "", "produce"),
      ing("cottage cheese", 1, "cup", "dairy"),
      ing("lemon", 0.5, "", "produce"),
      ing("fresh dill", 1, "tbsp", "produce"),
    ], "Blend cottage cheese with lemon and dill until smooth. Slice cucumber into thin half-moons for scooping."),

    mkSnack("Roasted sweet potato wedges", "sweet potato", "batch", 40, [
      ing("sweet potato", 3, "", "produce"),
      ing("olive oil", 2, "tbsp", "pantry"),
      ing("cinnamon", 0.5, "tsp", "pantry"),
    ], "Cut into finger-length wedges, toss with oil and cinnamon, roast at 425°F for 30 min. Keeps 4 days, good cold in the car."),

    mkSnack("Zucchini oat mini muffins", "zucchini", "batch", 35, [
      ing("zucchini", 2, "", "produce"),
      ing("rolled oats", 2, "cup", "pantry"),
      ing("eggs", 2, "", "dairy"),
      ing("plain yogurt", 0.5, "cup", "dairy"),
      ing("maple syrup", 3, "tbsp", "pantry"),
      ing("baking powder", 1, "tsp", "pantry"),
    ], "Blend oats to flour, fold in grated zucchini, bake in a mini tin at 350°F for 16 min. Freezes well."),

    mkSnack("Broccoli trees with yogurt ranch", "broccoli", "assembly", 8, [
      ing("broccoli crown", 1, "", "produce"),
      ing("plain whole-milk yogurt", 0.5, "cup", "dairy"),
      ing("garlic powder", 0.25, "tsp", "pantry"),
      ing("chives", 1, "tbsp", "produce"),
    ], "Steam florets 4 minutes so they squash easily, cool, serve with stirred-together yogurt dip."),

    mkSnack("Pea and cheese scoop cups", "peas", "grab", 2, [
      ing("frozen petite peas", 2, "cup", "frozen"),
      ing("mild cheddar", 4, "oz", "dairy"),
    ], "Thaw peas under warm water. Shred cheddar over the top and serve in a lidded cup."),

    mkSnack("Butternut and apple mash cups", "butternut squash", "batch", 35, [
      ing("butternut squash", 1, "", "produce"),
      ing("apple", 2, "", "produce"),
      ing("cinnamon", 0.5, "tsp", "pantry"),
    ], "Roast cubed squash and apple 25 min, mash, portion into small cups. Travels well."),

    mkSnack("Red pepper strips with hummus", "bell pepper", "assembly", 3, [
      ing("red bell pepper", 2, "", "produce"),
      ing("hummus", 1, "cup", "pantry"),
    ], "Slice pepper into thin strips she can hold. Hummus in a small dipping cup."),

    mkSnack("Spinach and banana silver-dollar pancakes", "spinach", "batch", 30, [
      ing("baby spinach", 3, "cup", "produce"),
      ing("banana", 2, "", "produce"),
      ing("eggs", 2, "", "dairy"),
      ing("rolled oats", 1.5, "cup", "pantry"),
      ing("milk", 0.5, "cup", "dairy"),
    ], "Blend everything, cook silver-dollar rounds, freeze flat with parchment between. Reheat 20 seconds."),

    mkSnack("Roasted cauliflower bites", "cauliflower", "batch", 30, [
      ing("cauliflower", 1, "head", "produce"),
      ing("olive oil", 2, "tbsp", "pantry"),
      ing("parmesan", 0.25, "cup", "dairy"),
    ], "Small florets, oil, roast at 425°F for 22 min until the edges brown. Dust with parmesan while hot."),

    mkSnack("Avocado white bean smash on toast fingers", "avocado", "assembly", 5, [
      ing("avocado", 1, "", "produce"),
      ing("cannellini beans", 1, "can", "pantry"),
      ing("soft sandwich bread", 2, "slice", "pantry"),
      ing("lemon", 0.5, "", "produce"),
    ], "Mash avocado and drained beans with lemon, spread thin on toast, cut into finger strips."),

    mkSnack("Soft-steamed carrot sticks", "carrot", "batch", 15, [
      ing("carrots", 6, "", "produce"),
      ing("butter", 1, "tbsp", "dairy"),
    ], "Cut into finger-length sticks, steam 10–12 min until they squash between your fingers. Toss with butter."),

    mkSnack("Corn and zucchini mini fritters", "corn", "batch", 30, [
      ing("frozen corn", 1.5, "cup", "frozen"),
      ing("zucchini", 1, "", "produce"),
      ing("eggs", 2, "", "dairy"),
      ing("flour", 0.5, "cup", "pantry"),
    ], "Squeeze the grated zucchini dry, mix, pan-fry small rounds 2 min a side. Freezes well."),

    mkSnack("Smashed edamame cups", "edamame", "grab", 2, [
      ing("shelled edamame", 2, "cup", "frozen"),
      ing("sesame oil", 1, "tsp", "pantry"),
    ], "Thaw and smash each bean lightly with a fork so nothing stays whole and round. Drizzle sesame oil."),

    mkSnack("Pink beet yogurt dip with pita fingers", "beet", "batch", 30, [
      ing("beets", 2, "", "produce"),
      ing("plain whole-milk yogurt", 1, "cup", "dairy"),
      ing("pita bread", 2, "", "pantry"),
      ing("lemon", 0.5, "", "produce"),
    ], "Roast beets until soft, blend with yogurt and lemon. Cut warm pita into soft strips."),
  ];
}

/* ------------------------------------------------------------ snack stats */

function avgScore(snack) {
  const rs = snack.ratings || [];
  if (!rs.length) return null;
  const total = rs.reduce((a, r) => a + (VERDICTS[r.verdict]?.score || 0), 0);
  return total / rs.length;
}
function lastVerdict(snack) {
  const rs = snack.ratings || [];
  return rs.length ? rs[rs.length - 1].verdict : null;
}

/* ------------------------------------------------------ suggestion engine */

function pickFromLibrary(library, currentWeekId, count, exclude = new Set()) {
  const scored = [];
  for (const s of library) {
    if (exclude.has(s.id)) continue;
    const gap = s.lastMadeWeek ? weeksBetween(s.lastMadeWeek, currentWeekId) : 999;
    const avg = avgScore(s);
    const loved = avg != null && avg >= 2.6;
    const refusedLast = lastVerdict(s) === "refused";

    // Variety rule: 3-week cooldown, shortened to 1 week for things she loves.
    const cooldown = loved ? 1 : 3;
    if (gap < cooldown) continue;

    let score = 1 + Math.random() * 0.6;
    if (loved) score += 1.1;
    if (avg != null && avg < 1.5) score += 0.15;          // never bury a refusal
    if (refusedLast && gap >= 3) score += 0.9;            // actively resurface it
    if (avg == null) score += 0.7;                        // untried library items
    score += Math.min(gap, 8) * 0.08;                     // longer gap, higher odds
    scored.push({ snack: s, score, refusedLast });
  }
  scored.sort((a, b) => b.score - a.score);

  // Spread the vegetables out rather than three squash ideas in one week.
  const out = [];
  const usedVeg = new Set();
  for (const row of scored) {
    if (out.length >= count) break;
    const veg = (row.snack.vegetable || "").toLowerCase();
    if (usedVeg.has(veg)) continue;
    usedVeg.add(veg);
    out.push({ ...row.snack, _reason: row.refusedLast ? "Worth another try" : null });
  }
  for (const row of scored) {
    if (out.length >= count) break;
    if (out.some((o) => o.id === row.snack.id)) continue;
    out.push({ ...row.snack, _reason: null });
  }
  return out;
}

/* ------------------------------------------------------------- Claude API */
/* The original Artifact version called api.anthropic.com directly from the
   browser with no key attached — that only works inside Claude's Artifact
   sandbox, which injects auth for you. Here we call a Supabase Edge
   Function instead, which holds the real Anthropic API key server-side. */

async function callClaude(prompt, { search = false } = {}) {
  const url = import.meta.env.VITE_SNACK_AI_URL;
  if (!url) throw new Error("AI features aren't configured (missing VITE_SNACK_AI_URL)");

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, search }),
  });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const data = await res.json();
  const text = (data.content || [])
    .filter((b) => b && b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  if (!text) throw new Error("Empty response");
  return text;
}

function extractJson(text) {
  let t = String(text).replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = t.search(/[[{]/);
  if (start === -1) throw new Error("No JSON found");
  const open = t[start];
  const close = open === "[" ? "]" : "}";
  let depth = 0, inStr = false, esc = false, end = -1;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) throw new Error("Truncated JSON");
  return JSON.parse(t.slice(start, end + 1));
}

function normalizeTier(t) {
  const s = String(t || "").toLowerCase();
  if (s.startsWith("grab") || s === "none") return "grab";
  if (s.startsWith("batch") || s.includes("weekend")) return "batch";
  return "assembly";
}

function normalizeIngredients(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((r) => {
    if (typeof r === "string") return ing(r, null, "", guessSection(r));
    const name = String(r.name || r.item || "").trim();
    const section = SECTIONS.includes(String(r.section || "").toLowerCase())
      ? String(r.section).toLowerCase()
      : guessSection(name);
    return ing(name, r.qty ?? r.quantity ?? r.amount ?? null, r.unit || "", section);
  }).filter((r) => r.name);
}

const SECTION_HINTS = [
  [/(yogurt|cheese|milk|butter|cream|cottage|kefir|egg)/i, "dairy"],
  [/(frozen|edamame|peas\b|corn kernels)/i, "frozen"],
  [/(oat|flour|oil|syrup|spice|cinnamon|powder|bread|pita|tortilla|hummus|bean|lentil|rice|pasta|vinegar|salt|pepper\b|sugar|tahini|seed|cracker|can\b)/i, "pantry"],
  [/(cucumber|zucchini|carrot|broccoli|pepper|spinach|kale|squash|potato|apple|banana|berry|berries|tomato|avocado|beet|cauliflower|onion|garlic|lemon|lime|herb|dill|chive|parsley|pear|mango|greens|corn|celery)/i, "produce"],
];
function guessSection(name) {
  for (const [re, sec] of SECTION_HINTS) if (re.test(name)) return sec;
  return "other";
}

function coerceSnack(raw) {
  return {
    id: newId(),
    title: String(raw.title || raw.name || "Untitled snack").trim(),
    vegetable: String(raw.vegetable || raw.veg || "mixed").trim().toLowerCase(),
    tier: normalizeTier(raw.tier),
    prepMinutes: Number(raw.prepMinutes ?? raw.prep_time ?? raw.minutes) || null,
    ingredients: normalizeIngredients(raw.ingredients),
    steps: String(raw.steps || raw.method || "").trim(),
    url: raw.url || "",
    source: "generated",
    ratings: [],
    lastMadeWeek: null,
    _reason: raw.why ? String(raw.why) : null,
  };
}

const JSON_RULES = `Return ONLY raw JSON. No markdown fences, no commentary before or after.
Quantities must be numbers (use decimals, not fractions) with a separate unit string ("" for whole items).
"section" must be one of: produce, dairy, pantry, frozen, other.
"tier" must be one of: grab (no prep), assembly (2-3 minutes), batch (30-45 minute weekend cook).`;

async function generateIdeas({ count, library, weeks, exposures, avoidTitles }) {
  const recent = weeks.slice(-3).flatMap((w) => (w.entries || []).map((e) => `${e.title} (${e.vegetable}) – ${VERDICTS[e.verdict]?.label || "not logged"}`));
  const lowExposure = Object.entries(exposures).filter(([, n]) => n < 4).map(([v]) => v);
  const winners = library.filter((s) => (avgScore(s) || 0) >= 2.6).map((s) => s.vegetable);

  const prompt = `You are helping two parents get more vegetables into their 2.5-year-old's snack rotation.

Give me ${count} NEW vegetable-forward snack ideas.

Hard requirements:
- Every idea is built around one clearly named vegetable.
- Dairy is welcome and she likes it, but it must not be the backbone of the snack — the vegetable is.
- Snacks are eaten at home and in a car seat or stroller, so they hold up at room temperature and aren't messy to hand over.
- Age-appropriate textures and safe cuts for 2.5 years old.

Context to work with:
Made in the last three weeks (avoid repeating): ${recent.length ? recent.join("; ") : "nothing logged yet"}
Vegetables she's responded well to: ${winners.length ? [...new Set(winners)].join(", ") : "unknown so far"}
Vegetables with few exposures so far (good to build on): ${lowExposure.length ? lowExposure.join(", ") : "all of them"}
Already in the library, do not repeat: ${avoidTitles.slice(0, 40).join("; ") || "none"}

${JSON_RULES}

Shape:
[{"title":"","vegetable":"","tier":"grab|assembly|batch","prepMinutes":5,"why":"one short clause on why it fits this week","steps":"1-2 sentences","ingredients":[{"name":"zucchini","qty":2,"unit":"","section":"produce"}]}]`;

  const text = await callClaude(prompt);
  const parsed = extractJson(text);
  const arr = Array.isArray(parsed) ? parsed : parsed.snacks || parsed.ideas || [];
  return arr.map(coerceSnack);
}

async function importRecipe(url) {
  const prompt = `Search the web for this recipe page and read it: ${url}

Extract it as a snack for a 2.5-year-old, keeping the quantities so they can feed a shopping list.

${JSON_RULES}

Shape:
{"title":"","vegetable":"the main vegetable it's built around","tier":"grab|assembly|batch","prepMinutes":20,"steps":"1-2 sentences","ingredients":[{"name":"zucchini","qty":2,"unit":"","section":"produce"}]}`;

  const text = await callClaude(prompt, { search: true });
  const parsed = extractJson(text);
  const obj = Array.isArray(parsed) ? parsed[0] : parsed;
  const snack = coerceSnack(obj || {});
  snack.url = url;
  snack.source = "url";
  return snack;
}

/* --------------------------------------------------------- shopping list */

function normName(n) {
  let s = String(n || "").trim().toLowerCase().replace(/\s+/g, " ");
  s = s.replace(/^(fresh|frozen|raw|organic)\s+/, "");
  if (s.length > 3 && s.endsWith("s") && !s.endsWith("ss")) s = s.slice(0, -1);
  return s;
}

function parseQty(v) {
  if (typeof v === "number") return isFinite(v) ? v : null;
  if (v == null || v === "") return null;
  const s = String(v).trim();
  let m = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (m) return +m[1] + +m[2] / +m[3];
  m = s.match(/^(\d+)\/(\d+)$/);
  if (m) return +m[1] / +m[2];
  const n = parseFloat(s);
  return isFinite(n) ? n : null;
}

function fmtQty(n) {
  if (n == null) return "";
  const r = Math.round(n * 100) / 100;
  return String(r);
}

function buildList(snacks) {
  const map = new Map();
  for (const s of snacks) {
    for (const item of s.ingredients || []) {
      const key = `${normName(item.name)}|${(item.unit || "").toLowerCase()}`;
      const qty = parseQty(item.qty);
      if (!map.has(key)) {
        map.set(key, {
          key,
          name: item.name,
          unit: item.unit || "",
          section: SECTIONS.includes(item.section) ? item.section : guessSection(item.name),
          qty: qty,
          unparsed: qty == null && item.qty ? [String(item.qty)] : [],
          from: [s.title],
        });
      } else {
        const row = map.get(key);
        if (qty != null) row.qty = (row.qty || 0) + qty;
        else if (item.qty) row.unparsed.push(String(item.qty));
        if (!row.from.includes(s.title)) row.from.push(s.title);
      }
    }
  }
  const rows = [...map.values()];
  rows.sort((a, b) => a.name.localeCompare(b.name));
  const grouped = {};
  for (const sec of SECTIONS) grouped[sec] = rows.filter((r) => r.section === sec);
  return { rows, grouped };
}

function rowLabel(row) {
  const parts = [];
  if (row.qty != null) parts.push(fmtQty(row.qty));
  if (row.unparsed && row.unparsed.length) parts.push(row.unparsed.join(" + "));
  if (row.unit) parts.push(row.unit);
  parts.push(row.name);
  return parts.filter(Boolean).join(" ");
}

/* --------------------------------------------------------------- UI bits */

function Pill({ active, onClick, children, tone }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 rounded-full text-sm font-medium border transition-colors ${
        active ? "text-white border-transparent" : "bg-white text-stone-600 border-stone-200"
      }`}
      style={active ? { backgroundColor: tone || "#3f6b46" } : undefined}
    >
      {children}
    </button>
  );
}

function VegDot({ veg, size = 10 }) {
  return (
    <span
      className="inline-block rounded-full shrink-0"
      style={{ width: size, height: size, backgroundColor: vegColor(veg) }}
    />
  );
}

function ExposureMeter({ count, target = EXPOSURE_TARGET, color }) {
  const cells = [];
  for (let i = 0; i < target; i++) {
    cells.push(
      <span key={i} className="rounded-sm" style={{
        width: 8, height: 14,
        backgroundColor: i < count ? color : "#e7e5e0",
      }} />
    );
  }
  const over = count > target ? count - target : 0;
  return (
    <span className="inline-flex items-center gap-1">
      <span className="inline-flex gap-0.5">{cells}</span>
      {over > 0 && <span className="text-xs text-stone-400">+{over}</span>}
    </span>
  );
}

function Sheet({ open, onClose, title, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ backgroundColor: "rgba(28,26,23,0.45)" }}>
      <div className="bg-white w-full rounded-t-2xl max-h-full overflow-y-auto" style={{ maxWidth: 560 }}>
        <div className="sticky top-0 bg-white flex items-center justify-between px-4 py-3 border-b border-stone-100">
          <h2 className="text-base font-semibold text-stone-800">{title}</h2>
          <button onClick={onClose} className="p-2 -m-2 text-stone-400"><X size={20} /></button>
        </div>
        <div className="p-4 pb-8">{children}</div>
      </div>
    </div>
  );
}

function Empty({ icon: Icon, children, action }) {
  return (
    <div className="text-center py-12 px-6">
      <Icon size={28} className="mx-auto mb-3 text-stone-300" />
      <p className="text-sm text-stone-500 leading-relaxed">{children}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------- app */

const emptyWeek = (id) => ({
  id,
  suggestions: [],
  selected: [],
  prepped: [],
  logs: {},
  libraryOnly: false,
  checked: {},
  have: {},
  manual: [],
});

export default function SnackPlanner() {
  const [tab, setTab] = useState("week");
  const [ready, setReady] = useState(false);
  const [storageOk, setStorageOk] = useState(true);

  const [library, setLibrary] = useState([]);
  const [weeks, setWeeks] = useState([]);
  const [exposures, setExposures] = useState({});
  const [week, setWeek] = useState(() => emptyWeek(weekStartOf()));
  const [pantry, setPantry] = useState([]);

  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);

  /* ------- load once ------- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!supabaseConfigured) setStorageOk(false);
      const core = await loadKey(KEY_CORE, null);
      const storedWeek = await loadKey(KEY_WEEK, null);
      const have = await loadKey(KEY_HAVE, []);
      if (cancelled) return;

      let lib = core?.library?.length ? core.library : seedLibrary();
      let wks = core?.weeks || [];
      const thisWeekId = weekStartOf();
      let cur = storedWeek && storedWeek.id === thisWeekId ? { ...emptyWeek(thisWeekId), ...storedWeek } : null;

      // Roll the calendar over: archive last week's record, start clean.
      if (!cur && storedWeek && storedWeek.id) {
        const entries = (storedWeek.prepped || []).map((sid) => {
          const s = lib.find((x) => x.id === sid) || (storedWeek.suggestions || []).find((x) => x.id === sid);
          return s ? {
            snackId: sid, title: s.title, vegetable: s.vegetable,
            tier: s.tier, verdict: storedWeek.logs?.[sid] || null,
          } : null;
        }).filter(Boolean);
        if (entries.length || (storedWeek.selected || []).length) {
          wks = [...wks, { id: storedWeek.id, entries }];
        }
        cur = emptyWeek(thisWeekId);
      }

      setLibrary(lib);
      setWeeks(wks);
      setExposures(core?.exposures || computeExposures(wks));
      setWeek(cur || emptyWeek(thisWeekId));
      setPantry(Array.isArray(have) ? have : []);
      setReady(true);
    })();
    return () => { cancelled = true; };
  }, []);

  /* ------- persist ------- */
  const firstRun = useRef(true);
  useEffect(() => {
    if (!ready) return;
    if (firstRun.current) { firstRun.current = false; return; }
    saveKey(KEY_CORE, { library, weeks, exposures });
  }, [library, weeks, exposures, ready]);

  useEffect(() => { if (ready) saveKey(KEY_WEEK, week); }, [week, ready]);
  useEffect(() => { if (ready) saveKey(KEY_HAVE, pantry); }, [pantry, ready]);

  function computeExposures(wks, extra = []) {
    const out = {};
    for (const w of wks) for (const e of w.entries || []) {
      if (!e.vegetable) continue;
      out[e.vegetable] = (out[e.vegetable] || 0) + 1;
    }
    for (const e of extra) out[e.vegetable] = (out[e.vegetable] || 0) + 1;
    return out;
  }

  const flash = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  }, []);

  /* ------- suggestions ------- */

  const suggestionPool = useMemo(() => {
    const byId = new Map(library.map((s) => [s.id, s]));
    return (week.suggestions || []).map((s) => byId.get(s.id) ? { ...byId.get(s.id), _reason: s._reason } : s);
  }, [week.suggestions, library]);

  const selectedSnacks = useMemo(() => {
    const byId = new Map([...library, ...suggestionPool].map((s) => [s.id, s]));
    return (week.selected || []).map((id) => byId.get(id)).filter(Boolean);
  }, [week.selected, library, suggestionPool]);

  async function buildWeek({ append = false } = {}) {
    setError(null);
    const libOnly = week.libraryOnly;
    const existing = append ? (week.suggestions || []) : [];
    const exclude = new Set(existing.map((s) => s.id));
    const total = 6;
    const need = append ? 3 : total;

    if (libOnly) {
      const picks = pickFromLibrary(library, week.id, need, exclude);
      setWeek((w) => ({ ...w, suggestions: [...existing, ...picks] }));
      if (!picks.length) setError("Everything in the library was made too recently. Turn off library-only or add a recipe.");
      return;
    }

    const libCount = Math.ceil(need / 2);
    const picks = pickFromLibrary(library, week.id, libCount, exclude);
    setWeek((w) => ({ ...w, suggestions: [...existing, ...picks] }));

    setBusy("ideas");
    try {
      const ideas = await generateIdeas({
        count: need - picks.length,
        library, weeks, exposures,
        avoidTitles: [...library.map((s) => s.title), ...existing.map((s) => s.title)],
      });
      setWeek((w) => ({ ...w, suggestions: [...existing, ...picks, ...ideas] }));
    } catch (e) {
      console.error("generateIdeas failed", e);
      setError(`Couldn't get new ideas (${e.message}). The library picks are below — try again, or add a recipe by URL.`);
    } finally {
      setBusy(null);
    }
  }

  function toggleSelected(snack) {
    setWeek((w) => {
      const has = w.selected.includes(snack.id);
      return { ...w, selected: has ? w.selected.filter((x) => x !== snack.id) : [...w.selected, snack.id],
               prepped: has ? w.prepped.filter((x) => x !== snack.id) : w.prepped };
    });
    // A generated idea earns its place in the library the moment it's chosen.
    if (!library.some((s) => s.id === snack.id) && !week.selected.includes(snack.id)) {
      const { _reason, ...clean } = snack;
      setLibrary((lib) => [...lib, clean]);
    }
  }

  function togglePrepped(id) {
    setWeek((w) => ({
      ...w,
      prepped: w.prepped.includes(id) ? w.prepped.filter((x) => x !== id) : [...w.prepped, id],
    }));
  }

  function logVerdict(snackId, verdict) {
    setWeek((w) => ({ ...w, logs: { ...w.logs, [snackId]: verdict } }));
    setLibrary((lib) => lib.map((s) => {
      if (s.id !== snackId) return s;
      const others = (s.ratings || []).filter((r) => r.weekId !== week.id);
      return { ...s, ratings: [...others, { weekId: week.id, verdict }], lastMadeWeek: week.id };
    }));
    const snack = [...library, ...suggestionPool].find((s) => s.id === snackId);
    if (snack) {
      setExposures((ex) => {
        const already = week.logs?.[snackId];
        if (already) return ex;
        return { ...ex, [snack.vegetable]: (ex[snack.vegetable] || 0) + 1 };
      });
      setWeeks((wks) => {
        const idx = wks.findIndex((w) => w.id === week.id);
        const entry = { snackId, title: snack.title, vegetable: snack.vegetable, tier: snack.tier, verdict };
        if (idx === -1) return [...wks, { id: week.id, entries: [entry] }];
        const copy = [...wks];
        const entries = (copy[idx].entries || []).filter((e) => e.snackId !== snackId);
        copy[idx] = { ...copy[idx], entries: [...entries, entry] };
        return copy;
      });
    }
  }

  function addToLibrary(snack) {
    setLibrary((lib) => [...lib, snack]);
    flash(`Saved ${snack.title}`);
  }

  function removeFromLibrary(id) {
    setLibrary((lib) => lib.filter((s) => s.id !== id));
    setWeek((w) => ({
      ...w,
      selected: w.selected.filter((x) => x !== id),
      prepped: w.prepped.filter((x) => x !== id),
      suggestions: w.suggestions.filter((s) => s.id !== id),
    }));
  }

  const needsLogging = useMemo(
    () => week.prepped.filter((id) => !week.logs?.[id]).length,
    [week.prepped, week.logs]
  );

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "#f7f7f4" }}>
        <Loader2 className="animate-spin text-stone-400" size={22} />
      </div>
    );
  }

  const TABS = [
    { id: "week", label: "Week", icon: Carrot, badge: 0 },
    { id: "list", label: "List", icon: ShoppingBasket, badge: 0 },
    { id: "log", label: "Log", icon: ClipboardCheck, badge: needsLogging },
    { id: "library", label: "Library", icon: BookMarked, badge: 0 },
    { id: "history", label: "History", icon: TrendingUp, badge: 0 },
  ];

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#f7f7f4", color: "#2b2926" }}>
      <div className="mx-auto pb-24" style={{ maxWidth: 560 }}>

        <header className="px-4 pt-5 pb-3">
          <div className="flex items-baseline justify-between">
            <h1 className="text-xl font-semibold tracking-tight">
              {tab === "week" && "This week"}
              {tab === "list" && "Shopping list"}
              {tab === "log" && "How'd it go"}
              {tab === "library" && "Library"}
              {tab === "history" && "History"}
            </h1>
            <span className="text-sm text-stone-500">{prettyWeek(week.id)}</span>
          </div>
        </header>

        {!storageOk && (
          <div className="mx-4 mb-3 rounded-lg px-3 py-2 text-xs" style={{ backgroundColor: "#fdf6e9", color: "#6b5a3a" }}>
            Supabase isn't configured, so nothing will be saved between visits. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.
          </div>
        )}

        {error && (
          <div className="mx-4 mb-3 rounded-lg px-3 py-2 text-xs flex items-start gap-2"
               style={{ backgroundColor: "#fbf0f1", color: "#6d4148" }}>
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)}><X size={14} /></button>
          </div>
        )}

        {tab === "week" && (
          <WeekView
            week={week} setWeek={setWeek} pool={suggestionPool} busy={busy}
            onBuild={buildWeek} onToggleSelect={toggleSelected} onTogglePrepped={togglePrepped}
            selectedCount={week.selected.length} onGoToList={() => setTab("list")}
          />
        )}

        {tab === "list" && (
          <ShoppingView
            snacks={selectedSnacks} week={week} setWeek={setWeek}
            pantry={pantry} setPantry={setPantry} flash={flash}
            onGoToWeek={() => setTab("week")}
          />
        )}

        {tab === "log" && (
          <LogView
            week={week} pool={[...library, ...suggestionPool]}
            onTogglePrepped={togglePrepped} onLog={logVerdict}
            onGoToWeek={() => setTab("week")}
          />
        )}

        {tab === "library" && (
          <LibraryView
            library={library} onAdd={addToLibrary} onRemove={removeFromLibrary}
            busy={busy} setBusy={setBusy} flash={flash}
          />
        )}

        {tab === "history" && (
          <HistoryView weeks={weeks} exposures={exposures} library={library} />
        )}
      </div>

      {toast && (
        <div className="fixed left-0 right-0 flex justify-center z-40" style={{ bottom: 88 }}>
          <div className="px-4 py-2 rounded-full text-sm text-white shadow-lg" style={{ backgroundColor: "#3f4540" }}>
            {toast}
          </div>
        </div>
      )}

      <nav className="fixed bottom-0 left-0 right-0 border-t border-stone-200 bg-white">
        <div className="mx-auto flex" style={{ maxWidth: 560 }}>
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button key={t.id} onClick={() => setTab(t.id)}
                      className="flex-1 flex flex-col items-center gap-1 py-3 pb-5 relative">
                <Icon size={20} style={{ color: active ? "#3f6b46" : "#a8a29e" }} />
                <span className="text-xs" style={{ color: active ? "#3f6b46" : "#a8a29e" }}>{t.label}</span>
                {t.badge > 0 && (
                  <span className="absolute rounded-full text-white flex items-center justify-center"
                        style={{ top: 6, right: "50%", marginRight: -22, width: 16, height: 16, fontSize: 10, backgroundColor: "#b1791f" }}>
                    {t.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

/* -------------------------------------------------------------- week view */

function WeekView({ week, setWeek, pool, busy, onBuild, onToggleSelect, onTogglePrepped, selectedCount, onGoToList }) {
  const [tierFilter, setTierFilter] = useState([]);
  const shown = pool.filter((s) => !tierFilter.length || tierFilter.includes(s.tier));

  function toggleTier(t) {
    setTierFilter((f) => (f.includes(t) ? f.filter((x) => x !== t) : [...f, t]));
  }

  return (
    <div className="px-4">
      <div className="flex items-center justify-between gap-3 mb-4">
        <button
          onClick={() => setWeek((w) => ({ ...w, libraryOnly: !w.libraryOnly }))}
          className="flex items-center gap-2 text-sm text-stone-600"
        >
          <span
            className="rounded-full p-0.5 transition-colors flex"
            style={{ width: 40, backgroundColor: week.libraryOnly ? "#3f6b46" : "#dedbd4" }}
          >
            <span className="bg-white rounded-full block" style={{ width: 18, height: 18, marginLeft: week.libraryOnly ? 18 : 0 }} />
          </span>
          Library only
        </button>

        <button
          onClick={() => onBuild({ append: false })}
          disabled={busy === "ideas"}
          className="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium text-white"
          style={{ backgroundColor: "#3f6b46", opacity: busy === "ideas" ? 0.6 : 1 }}
        >
          {busy === "ideas" ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
          {pool.length ? "New set" : "Suggest snacks"}
        </button>
      </div>

      {pool.length > 0 && (
        <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
          {TIER_ORDER.map((t) => (
            <Pill key={t} active={tierFilter.includes(t)} onClick={() => toggleTier(t)}>
              {TIERS[t].label}
            </Pill>
          ))}
        </div>
      )}

      {!pool.length && (
        <Empty icon={Carrot}>
          Nothing planned yet. Suggestions pull half from your library and half from new ideas,
          skipping anything you made in the last few weeks.
        </Empty>
      )}

      <div className="space-y-3">
        {shown.map((s) => (
          <SnackCard
            key={s.id} snack={s}
            selected={week.selected.includes(s.id)}
            prepped={week.prepped.includes(s.id)}
            onSelect={() => onToggleSelect(s)}
            onPrepped={() => onTogglePrepped(s.id)}
          />
        ))}
      </div>

      {busy === "ideas" && (
        <div className="flex items-center gap-2 justify-center py-6 text-sm text-stone-500">
          <Loader2 size={16} className="animate-spin" /> Thinking up new ideas
        </div>
      )}

      {pool.length > 0 && busy !== "ideas" && (
        <button
          onClick={() => onBuild({ append: true })}
          className="w-full mt-4 py-3 rounded-xl border border-stone-200 bg-white text-sm text-stone-600 flex items-center justify-center gap-1.5"
        >
          <Plus size={15} /> More ideas
        </button>
      )}

      {selectedCount > 0 && (
        <button
          onClick={onGoToList}
          className="w-full mt-4 py-3.5 rounded-xl text-white text-sm font-medium flex items-center justify-center gap-2"
          style={{ backgroundColor: "#2b2926" }}
        >
          <ShoppingBasket size={16} />
          {selectedCount} chosen — see the shopping list
        </button>
      )}

    </div>
  );
}

function SnackCard({ snack, selected, prepped, onSelect, onPrepped }) {
  const [open, setOpen] = useState(false);
  const avg = avgScore(snack);
  const last = lastVerdict(snack);

  return (
    <div className="bg-white rounded-xl border" style={{ borderColor: selected ? "#3f6b46" : "#eae8e3" }}>
      <div className="flex">
        <button onClick={onSelect} className="pl-4 pr-3 py-4 flex items-start shrink-0">
          <span className="rounded-md border flex items-center justify-center"
                style={{
                  width: 24, height: 24,
                  borderColor: selected ? "#3f6b46" : "#d6d3cd",
                  backgroundColor: selected ? "#3f6b46" : "transparent",
                }}>
            {selected && <Check size={15} color="white" strokeWidth={3} />}
          </span>
        </button>

        <div className="flex-1 py-4 pr-4 min-w-0">
          <button onClick={() => setOpen((o) => !o)} className="text-left w-full">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-sm font-semibold leading-snug text-stone-800">{snack.title}</h3>
              {open ? <ChevronDown size={16} className="text-stone-300 shrink-0 mt-0.5" />
                    : <ChevronRight size={16} className="text-stone-300 shrink-0 mt-0.5" />}
            </div>
            <div className="flex items-center gap-2 flex-wrap mt-1.5 text-xs text-stone-500">
              <span className="inline-flex items-center gap-1.5">
                <VegDot veg={snack.vegetable} /> {snack.vegetable}
              </span>
              <span className="text-stone-300">·</span>
              <span className="inline-flex items-center gap-1">
                <Clock size={11} />
                {snack.tier === "grab" ? "grab and go"
                  : snack.prepMinutes ? `${snack.prepMinutes} min` : TIERS[snack.tier].label.toLowerCase()}
              </span>
              {last && (
                <>
                  <span className="text-stone-300">·</span>
                  <span style={{ color: VERDICTS[last].tone }}>{VERDICTS[last].label.toLowerCase()} last time</span>
                </>
              )}
            </div>
            {snack._reason && (
              <p className="text-xs mt-1.5 inline-flex items-center gap-1" style={{ color: "#6b7f2f" }}>
                <Sparkles size={11} /> {snack._reason}
              </p>
            )}
            {!snack._reason && last === "refused" && (
              <p className="text-xs mt-1.5" style={{ color: "#7a6f60" }}>
                Back for another go — it can take ten tries.
              </p>
            )}
          </button>

          {open && (
            <div className="mt-3">
              {snack.steps && <p className="text-xs text-stone-600 leading-relaxed">{snack.steps}</p>}
              {!!(snack.ingredients || []).length && (
                <ul className="mt-2 text-xs text-stone-500 space-y-0.5">
                  {snack.ingredients.map((i, n) => (
                    <li key={n}>{[i.qty != null ? fmtQty(parseQty(i.qty)) : "", i.unit, i.name].filter(Boolean).join(" ")}</li>
                  ))}
                </ul>
              )}
              {snack.url && (
                <a href={snack.url} target="_blank" rel="noreferrer"
                   className="inline-flex items-center gap-1 text-xs mt-2" style={{ color: "#3f6b46" }}>
                  <Link2 size={11} /> recipe
                </a>
              )}
            </div>
          )}

          {selected && (
            <button
              onClick={onPrepped}
              className="mt-3 w-full py-2.5 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5"
              style={{
                backgroundColor: prepped ? "#eef3ee" : "#f5f4f1",
                color: prepped ? "#3f6b46" : "#78716c",
              }}
            >
              {prepped ? <><Check size={13} /> Prepped</> : "Mark as prepped"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- shopping view */

function ShoppingView({ snacks, week, setWeek, pantry, setPantry, flash, onGoToWeek }) {
  const { grouped, rows } = useMemo(() => buildList(snacks), [snacks]);
  const [showHave, setShowHave] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftSection, setDraftSection] = useState("produce");

  const pantrySet = useMemo(() => new Set(pantry), [pantry]);
  const isHave = (row) => !!week.have?.[row.key] || pantrySet.has(normName(row.name));

  function toggleCheck(key) {
    setWeek((w) => ({ ...w, checked: { ...w.checked, [key]: !w.checked?.[key] } }));
  }

  function toggleHave(row) {
    const n = normName(row.name);
    const currentlyHave = isHave(row);
    setWeek((w) => ({ ...w, have: { ...w.have, [row.key]: !currentlyHave } }));
    setPantry((p) => (currentlyHave ? p.filter((x) => x !== n) : [...new Set([...p, n])]));
  }

  function addManual() {
    const text = draft.trim();
    if (!text) return;
    setWeek((w) => ({
      ...w,
      manual: [...(w.manual || []), { id: newId(), name: text, section: draftSection, checked: false }],
    }));
    setDraft("");
  }

  function toggleManual(id) {
    setWeek((w) => ({
      ...w,
      manual: (w.manual || []).map((m) => (m.id === id ? { ...m, checked: !m.checked } : m)),
    }));
  }
  function removeManual(id) {
    setWeek((w) => ({ ...w, manual: (w.manual || []).filter((m) => m.id !== id) }));
  }

  const haveRows = rows.filter(isHave);

  const plainText = useMemo(() => {
    const lines = [`Snacks — week of ${prettyWeek(week.id)}`, ""];
    for (const sec of SECTIONS) {
      const items = (grouped[sec] || []).filter((r) => !isHave(r) && !week.checked?.[r.key]);
      const manual = (week.manual || []).filter((m) => m.section === sec && !m.checked);
      if (!items.length && !manual.length) continue;
      lines.push(SECTION_LABEL[sec]);
      for (const r of items) lines.push(`- ${rowLabel(r)}`);
      for (const m of manual) lines.push(`- ${m.name}`);
      lines.push("");
    }
    return lines.join("\n").trim();
  }, [grouped, week, pantry]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(plainText);
      flash("List copied");
    } catch {
      const ta = document.createElement("textarea");
      ta.value = plainText;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); flash("List copied"); }
      catch { flash("Copy didn't work — select the text instead"); }
      document.body.removeChild(ta);
    }
  }

  if (!snacks.length && !(week.manual || []).length) {
    return (
      <Empty icon={ShoppingBasket} action={
        <button onClick={onGoToWeek} className="px-4 py-2.5 rounded-full text-sm text-white" style={{ backgroundColor: "#3f6b46" }}>
          Pick this week's snacks
        </button>
      }>
        Choose snacks on the week tab and the list builds itself, with repeat ingredients added up.
      </Empty>
    );
  }

  return (
    <div className="px-4">
      <div className="flex items-center justify-between mb-4 text-sm text-stone-500">
        <span>{snacks.length} snack{snacks.length === 1 ? "" : "s"}</span>
        <button onClick={copy} className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-white border border-stone-200">
          <Copy size={14} /> Copy as text
        </button>
      </div>

      <div className="space-y-5">
        {SECTIONS.map((sec) => {
          const items = (grouped[sec] || []).filter((r) => !isHave(r));
          const manual = (week.manual || []).filter((m) => m.section === sec);
          if (!items.length && !manual.length) return null;
          return (
            <div key={sec}>
              <h3 className="text-xs font-semibold text-stone-400 mb-2 px-1">{SECTION_LABEL[sec]}</h3>
              <div className="bg-white rounded-xl border border-stone-200 divide-y divide-stone-100">
                {items.map((r) => {
                  const done = !!week.checked?.[r.key];
                  return (
                    <div key={r.key} className="flex items-center">
                      <button onClick={() => toggleCheck(r.key)} className="flex-1 flex items-center gap-3 px-4 py-3.5 text-left">
                        <span className="rounded-md border flex items-center justify-center shrink-0"
                              style={{ width: 22, height: 22, borderColor: done ? "#3f6b46" : "#d6d3cd", backgroundColor: done ? "#3f6b46" : "transparent" }}>
                          {done && <Check size={14} color="white" strokeWidth={3} />}
                        </span>
                        <span className="min-w-0">
                          <span className={`text-sm block ${done ? "line-through text-stone-300" : "text-stone-700"}`}>
                            {rowLabel(r)}
                          </span>
                          {r.from.length > 1 && (
                            <span className="text-xs text-stone-400">for {r.from.length} snacks</span>
                          )}
                        </span>
                      </button>
                      <button onClick={() => toggleHave(r)} className="px-3 py-3.5 text-xs text-stone-400 shrink-0">
                        have it
                      </button>
                    </div>
                  );
                })}
                {manual.map((m) => (
                  <div key={m.id} className="flex items-center">
                    <button onClick={() => toggleManual(m.id)} className="flex-1 flex items-center gap-3 px-4 py-3.5 text-left">
                      <span className="rounded-md border flex items-center justify-center shrink-0"
                            style={{ width: 22, height: 22, borderColor: m.checked ? "#3f6b46" : "#d6d3cd", backgroundColor: m.checked ? "#3f6b46" : "transparent" }}>
                        {m.checked && <Check size={14} color="white" strokeWidth={3} />}
                      </span>
                      <span className={`text-sm ${m.checked ? "line-through text-stone-300" : "text-stone-700"}`}>{m.name}</span>
                    </button>
                    <button onClick={() => removeManual(m.id)} className="px-3 py-3.5 text-stone-300 shrink-0">
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-5 bg-white rounded-xl border border-stone-200 p-3">
        <div className="flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addManual(); }}
            placeholder="Add something else"
            className="flex-1 px-3 py-2.5 rounded-lg bg-stone-50 text-sm outline-none"
          />
          <button onClick={addManual} className="px-4 rounded-lg text-white" style={{ backgroundColor: "#3f6b46" }}>
            <Plus size={16} />
          </button>
        </div>
        <div className="flex gap-1.5 mt-2 overflow-x-auto">
          {SECTIONS.map((s) => (
            <button key={s} onClick={() => setDraftSection(s)}
                    className="px-2.5 py-1.5 rounded-full text-xs shrink-0"
                    style={{
                      backgroundColor: draftSection === s ? "#eef3ee" : "transparent",
                      color: draftSection === s ? "#3f6b46" : "#a8a29e",
                    }}>
              {SECTION_LABEL[s]}
            </button>
          ))}
        </div>
      </div>

      {haveRows.length > 0 && (
        <div className="mt-5">
          <button onClick={() => setShowHave((v) => !v)} className="flex items-center gap-1.5 text-xs text-stone-400 px-1">
            {showHave ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            {haveRows.length} already at home
          </button>
          {showHave && (
            <div className="mt-2 bg-white rounded-xl border border-stone-200 divide-y divide-stone-100">
              {haveRows.map((r) => (
                <div key={r.key} className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm text-stone-400">{rowLabel(r)}</span>
                  <button onClick={() => toggleHave(r)} className="text-xs" style={{ color: "#3f6b46" }}>
                    add back
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- log view */

function LogView({ week, pool, onTogglePrepped, onLog, onGoToWeek }) {
  const byId = new Map(pool.map((s) => [s.id, s]));
  const chosen = week.selected.map((id) => byId.get(id)).filter(Boolean);

  if (!chosen.length) {
    return (
      <Empty icon={ClipboardCheck} action={
        <button onClick={onGoToWeek} className="px-4 py-2.5 rounded-full text-sm text-white" style={{ backgroundColor: "#3f6b46" }}>
          Pick this week's snacks
        </button>
      }>
        Once you've picked snacks for the week, rate them here. Ratings steer next week's suggestions.
      </Empty>
    );
  }

  return (
    <div className="px-4 space-y-3">
      {chosen.map((s) => {
        const prepped = week.prepped.includes(s.id);
        const verdict = week.logs?.[s.id];
        return (
          <div key={s.id} className="bg-white rounded-xl border border-stone-200 p-4">
            <div className="flex items-start gap-3">
              <button onClick={() => onTogglePrepped(s.id)} className="shrink-0 mt-0.5">
                <span className="rounded-md border flex items-center justify-center"
                      style={{ width: 22, height: 22, borderColor: prepped ? "#3f6b46" : "#d6d3cd", backgroundColor: prepped ? "#3f6b46" : "transparent" }}>
                  {prepped && <Check size={14} color="white" strokeWidth={3} />}
                </span>
              </button>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-stone-800 leading-snug">{s.title}</h3>
                <p className="text-xs text-stone-500 mt-1 inline-flex items-center gap-1.5">
                  <VegDot veg={s.vegetable} /> {s.vegetable}
                </p>
              </div>
            </div>

            {prepped ? (
              <div className="flex gap-2 mt-3">
                {Object.entries(VERDICTS).map(([k, v]) => {
                  const on = verdict === k;
                  return (
                    <button key={k} onClick={() => onLog(s.id, k)}
                            className="flex-1 py-3 rounded-lg text-xs font-medium border"
                            style={{
                              borderColor: on ? v.tone : "#eae8e3",
                              backgroundColor: on ? v.tone : "white",
                              color: on ? "white" : "#78716c",
                            }}>
                      {v.label}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-stone-400 mt-3">Mark it prepped to rate it.</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ----------------------------------------------------------- library view */

function LibraryView({ library, onAdd, onRemove, busy, setBusy, flash }) {
  const [q, setQ] = useState("");
  const [sheet, setSheet] = useState(null); // "url" | "manual"
  const [url, setUrl] = useState("");
  const [importError, setImportError] = useState(null);

  const filtered = library.filter((s) => {
    if (!q.trim()) return true;
    const t = `${s.title} ${s.vegetable} ${(s.ingredients || []).map((i) => i.name).join(" ")}`.toLowerCase();
    return t.includes(q.toLowerCase());
  });

  async function doImport() {
    const link = url.trim();
    if (!link) return;
    setImportError(null);
    setBusy("import");
    try {
      const snack = await importRecipe(link);
      onAdd(snack);
      setUrl("");
      setSheet(null);
    } catch (e) {
      setImportError("Couldn't read that page. Keep the link and fill in the details yourself.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="px-4">
      <div className="flex gap-2 mb-4">
        <div className="flex-1 flex items-center gap-2 bg-white border border-stone-200 rounded-full px-3.5">
          <Search size={15} className="text-stone-300 shrink-0" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search snacks or vegetables"
                 className="flex-1 py-2.5 text-sm outline-none bg-transparent" />
          {q && <button onClick={() => setQ("")} className="text-stone-300"><X size={15} /></button>}
        </div>
        <button onClick={() => { setSheet("url"); setImportError(null); }}
                className="px-4 rounded-full text-white flex items-center" style={{ backgroundColor: "#3f6b46" }}>
          <Plus size={18} />
        </button>
      </div>

      {!filtered.length && (
        <Empty icon={BookMarked}>Nothing matches that. Try a vegetable name.</Empty>
      )}

      <div className="space-y-2">
        {filtered.map((s) => {
          const avg = avgScore(s);
          const last = lastVerdict(s);
          return (
            <div key={s.id} className="bg-white rounded-xl border border-stone-200 px-4 py-3.5 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-medium text-stone-800 leading-snug">{s.title}</h3>
                <div className="flex items-center gap-2 flex-wrap mt-1 text-xs text-stone-500">
                  <span className="inline-flex items-center gap-1.5"><VegDot veg={s.vegetable} /> {s.vegetable}</span>
                  <span className="text-stone-300">·</span>
                  <span>{TIERS[s.tier].label}</span>
                  {last && (
                    <>
                      <span className="text-stone-300">·</span>
                      <span style={{ color: VERDICTS[last].tone }}>{VERDICTS[last].label.toLowerCase()}</span>
                    </>
                  )}
                </div>
                <p className="text-xs text-stone-400 mt-1">
                  {s.lastMadeWeek ? `Made week of ${prettyWeek(s.lastMadeWeek)}` : "Not made yet"}
                  {(s.ratings || []).length > 1 && ` · ${s.ratings.length} times`}
                </p>
              </div>
              <button onClick={() => onRemove(s.id)} className="p-2 -m-1 text-stone-300 shrink-0">
                <Trash2 size={15} />
              </button>
            </div>
          );
        })}
      </div>

      <Sheet open={sheet === "url"} onClose={() => setSheet(null)} title="Add a recipe">
        <p className="text-sm text-stone-500 leading-relaxed mb-3">
          Paste a link and the ingredients and quantities get pulled in so they feed the shopping list.
        </p>
        <input
          value={url} onChange={(e) => setUrl(e.target.value)}
          placeholder="https://"
          className="w-full px-3.5 py-3 rounded-lg bg-stone-50 text-sm outline-none"
        />
        {importError && (
          <div className="mt-3 rounded-lg px-3 py-2 text-xs" style={{ backgroundColor: "#fbf0f1", color: "#6d4148" }}>
            {importError}
          </div>
        )}
        <div className="flex gap-2 mt-4">
          <button onClick={() => setSheet("manual")} className="flex-1 py-3 rounded-lg border border-stone-200 text-sm text-stone-600">
            Enter by hand
          </button>
          <button onClick={doImport} disabled={busy === "import" || !url.trim()}
                  className="flex-1 py-3 rounded-lg text-white text-sm font-medium flex items-center justify-center gap-2"
                  style={{ backgroundColor: "#3f6b46", opacity: busy === "import" || !url.trim() ? 0.5 : 1 }}>
            {busy === "import" ? <><Loader2 size={15} className="animate-spin" /> Reading</> : "Pull it in"}
          </button>
        </div>
      </Sheet>

      <Sheet open={sheet === "manual"} onClose={() => setSheet(null)} title="Add by hand">
        <ManualForm
          initialUrl={url}
          onSave={(snack) => { onAdd(snack); setUrl(""); setSheet(null); }}
        />
      </Sheet>
    </div>
  );
}

function ManualForm({ initialUrl, onSave }) {
  const [title, setTitle] = useState("");
  const [veg, setVeg] = useState("");
  const [tier, setTier] = useState("assembly");
  const [lines, setLines] = useState("");

  function save() {
    if (!title.trim()) return;
    const ingredients = lines.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
      const m = l.match(/^([\d./\s]+)?\s*(tbsp|tsp|cup|cups|oz|lb|g|kg|can|head|slice|bunch)?\s*(.+)$/i);
      const name = (m && m[3] ? m[3] : l).trim();
      return ing(name, m && m[1] ? parseQty(m[1]) : null, m && m[2] ? m[2].toLowerCase() : "", guessSection(name));
    });
    onSave({
      id: newId(), title: title.trim(), vegetable: veg.trim().toLowerCase() || "mixed",
      tier, prepMinutes: null, ingredients, steps: "", url: initialUrl || "",
      source: "manual", ratings: [], lastMadeWeek: null,
    });
  }

  return (
    <div className="space-y-3">
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Snack name"
             className="w-full px-3.5 py-3 rounded-lg bg-stone-50 text-sm outline-none" />
      <input value={veg} onChange={(e) => setVeg(e.target.value)} placeholder="Main vegetable"
             className="w-full px-3.5 py-3 rounded-lg bg-stone-50 text-sm outline-none" />
      <div className="flex gap-2">
        {TIER_ORDER.map((t) => (
          <Pill key={t} active={tier === t} onClick={() => setTier(t)}>{TIERS[t].label}</Pill>
        ))}
      </div>
      <textarea value={lines} onChange={(e) => setLines(e.target.value)} rows={5}
                placeholder={"One ingredient per line\n2 zucchini\n1 cup yogurt"}
                className="w-full px-3.5 py-3 rounded-lg bg-stone-50 text-sm outline-none resize-none" />
      <button onClick={save} disabled={!title.trim()}
              className="w-full py-3 rounded-lg text-white text-sm font-medium"
              style={{ backgroundColor: "#3f6b46", opacity: title.trim() ? 1 : 0.5 }}>
        Save to library
      </button>
    </div>
  );
}

/* ----------------------------------------------------------- history view */

function HistoryView({ weeks, exposures, library }) {
  const vegStats = useMemo(() => {
    const map = {};
    for (const w of weeks) {
      for (const e of w.entries || []) {
        if (!e.vegetable) continue;
        if (!map[e.vegetable]) map[e.vegetable] = { veg: e.vegetable, tries: [], count: 0 };
        map[e.vegetable].count += 1;
        if (e.verdict) map[e.vegetable].tries.push(VERDICTS[e.verdict].score);
      }
    }
    return Object.values(map).map((v) => {
      const t = v.tries;
      const recent = t.slice(-3);
      const earlier = t.slice(0, Math.max(0, t.length - 3));
      const recentAvg = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : null;
      const earlierAvg = earlier.length ? earlier.reduce((a, b) => a + b, 0) / earlier.length : null;
      const warming = recentAvg != null && earlierAvg != null && recentAvg > earlierAvg + 0.3;
      return { ...v, recentAvg, warming, exposures: exposures[v.veg] ?? v.count };
    }).sort((a, b) => b.exposures - a.exposures);
  }, [weeks, exposures]);

  const past = [...weeks].reverse();

  if (!vegStats.length && !past.length) {
    return (
      <Empty icon={TrendingUp}>
        Once you've logged a week, vegetable-by-vegetable exposure counts show up here.
      </Empty>
    );
  }

  return (
    <div className="px-4">
      <section className="mb-7">
        <h2 className="text-sm font-semibold text-stone-700 mb-1">Exposures by vegetable</h2>
        <p className="text-xs text-stone-400 leading-relaxed mb-3">
          Acceptance often takes ten or more calm tries. A short bar isn't a no yet.
        </p>
        <div className="bg-white rounded-xl border border-stone-200 divide-y divide-stone-100">
          {vegStats.map((v) => (
            <div key={v.veg} className="px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-stone-700 inline-flex items-center gap-2 min-w-0">
                  <VegDot veg={v.veg} /> <span className="truncate">{v.veg}</span>
                </span>
                <span className="flex items-center gap-2 shrink-0">
                  {v.warming && <span className="text-xs" style={{ color: "#2f7d55" }}>warming up</span>}
                  <ExposureMeter count={v.exposures} color={vegColor(v.veg)} />
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-stone-700 mb-3">Past weeks</h2>
        <div className="space-y-3">
          {past.map((w) => (
            <div key={w.id} className="bg-white rounded-xl border border-stone-200 px-4 py-3.5">
              <h3 className="text-xs font-medium text-stone-400 mb-2">{prettyWeek(w.id)}</h3>
              <ul className="space-y-1.5">
                {(w.entries || []).map((e, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-stone-700 truncate">{e.title}</span>
                    {e.verdict && (
                      <span className="text-xs shrink-0" style={{ color: VERDICTS[e.verdict].tone }}>
                        {VERDICTS[e.verdict].label}
                      </span>
                    )}
                  </li>
                ))}
                {!(w.entries || []).length && <li className="text-sm text-stone-400">Nothing logged</li>}
              </ul>
            </div>
          ))}
          {!past.length && <p className="text-sm text-stone-400">This is your first week.</p>}
        </div>
      </section>
    </div>
  );
}
