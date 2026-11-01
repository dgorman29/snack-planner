import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  Carrot, ShoppingBasket, ClipboardCheck, BookMarked, TrendingUp,
  Plus, Check, X, Link2, Loader2, Copy, Search, RefreshCw,
  ChevronDown, ChevronRight, Trash2, Sparkles, Clock, Pencil, Camera, ChefHat,
} from "lucide-react";
import { supabase, supabaseConfigured } from "./lib/supabaseClient";

/* ---------------------------------------------------------------- storage */
/* Same three keys as the original Artifact version (window.storage), now
   backed by a single `kv_store(key text primary key, value jsonb)` table
   in Supabase instead. */

const KEY_CORE = "snackplan:core:v1";     // library + archived weeks + exposure counts
const KEY_WEEK = "snackplan:week:v1";     // this week: suggestions, picks, prepped, list state
const KEY_NEXT = "snackplan:nextweek:v1"; // next week's plan, made ahead; becomes "this week" on Monday
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

// The Monday after the week that `id` starts.
function nextWeekId(id = weekStartOf()) {
  const d = new Date(id + "T12:00:00");
  d.setDate(d.getDate() + 7);
  return weekStartOf(d);
}

function prettyWeek(id) {
  const d = new Date(id + "T12:00:00");
  const end = new Date(d);
  end.setDate(end.getDate() + 6);
  const f = (x) => x.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${f(d)} – ${f(end)}`;
}

// Dinners are planned for every day of the week; days are numbered from Monday = 0.
const DINNER_DAYS = [0, 1, 2, 3, 4, 5, 6];
const todayIndex = () => (new Date().getDay() + 6) % 7;

function dayInfo(weekId, idx) {
  const d = new Date(weekId + "T12:00:00");
  d.setDate(d.getDate() + idx);
  return {
    short: d.toLocaleDateString(undefined, { weekday: "short" }),
    long: d.toLocaleDateString(undefined, { weekday: "long" }),
    date: d.getDate(),
  };
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

// Optional tags stored on a snack as `tags: [...]`. Older snacks have no `tags` field.
const DINNER_TAG = "weekday-dinner";
const TAG_LABEL = { [DINNER_TAG]: "Weekday dinner" };
const hasTag = (snack, tag) => (snack.tags || []).includes(tag);

const SECTIONS = ["produce", "dairy", "pantry", "frozen", "other"];
const SECTION_LABEL = {
  produce: "Produce", dairy: "Dairy", pantry: "Pantry", frozen: "Frozen", other: "Other",
};
// Tailwind background class for each shopping-list section's label.
const SECTION_BG = {
  produce: "bg-mint", dairy: "bg-butter", pantry: "bg-peach", frozen: "bg-ice", other: "bg-lilac",
};

// `tone` is a text colour that reads on white or blush; `bg` fills the rating buttons.
const VERDICTS = {
  loved: { label: "Loved it", score: 3, tone: "#2D4A3A", bg: "bg-mint" },
  some: { label: "Ate some", score: 2, tone: "#7A4E0F", bg: "bg-butter" },
  refused: { label: "Refused", score: 1, tone: "#9A2F4B", bg: "bg-peach" },
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

// Minutes shown for a recipe: the average of its timed cooking sessions (`cookTimes`,
// in seconds) once there is one, otherwise the estimate entered or imported.
function cookMinutes(snack) {
  const t = snack.cookTimes || [];
  if (!t.length) return snack.prepMinutes || null;
  return Math.max(1, Math.round(t.reduce((a, b) => a + b, 0) / t.length / 60));
}

/* ----------------------------------------------------------- cooking session */
/* A session lives on this device only (not in the shared week data), so it can
   survive a reload mid-cook without showing up on someone else's phone. */

const KEY_COOKING = "snackplan:cooking:v1";
const COOKING_STALE_MS = 12 * 60 * 60 * 1000; // an older session was walked away from

function loadCooking() {
  try {
    const c = JSON.parse(localStorage.getItem(KEY_COOKING));
    if (c && c.id && Date.now() - c.startedAt < COOKING_STALE_MS && c.startedAt <= Date.now()) return c;
  } catch (e) { /* storage unavailable or unreadable */ }
  return null;
}

function saveCooking(c) {
  try {
    if (c) localStorage.setItem(KEY_COOKING, JSON.stringify(c));
    else localStorage.removeItem(KEY_COOKING);
  } catch (e) { /* storage unavailable */ }
}

function fmtClock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
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

async function callClaude(prompt, { search = false, images } = {}) {
  const url = import.meta.env.VITE_SNACK_AI_URL;
  if (!url) throw new Error("AI features aren't configured (missing VITE_SNACK_AI_URL)");

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not signed in");

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ prompt, search, images }),
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

// The full method is stored as text, one step per line.
function joinMethod(m) {
  return (Array.isArray(m) ? m.join("\n") : String(m || "")).trim();
}

function coerceSnack(raw) {
  return {
    id: newId(),
    title: String(raw.title || raw.name || "Untitled snack").trim(),
    vegetable: String(raw.vegetable || raw.veg || "mixed").trim().toLowerCase(),
    tier: normalizeTier(raw.tier),
    prepMinutes: Number(raw.prepMinutes ?? raw.prep_time ?? raw.minutes) || null,
    ingredients: normalizeIngredients(raw.ingredients),
    steps: String(raw.steps || joinMethod(raw.method)).trim(),
    method: joinMethod(raw.method),
    url: raw.url || "",
    tags: [],
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

const METHOD_SHAPE = "every step of the recipe's method in full, in order, one step per line, no numbering, nothing left out or shortened";

async function importRecipe(url) {
  const prompt = `Search the web for this recipe page and read it: ${url}

Extract it as a snack for a 2.5-year-old, keeping the quantities so they can feed a shopping list.
"steps" is a short summary for a card; "method" is the complete recipe for cooking from.

${JSON_RULES}

Shape:
{"title":"","vegetable":"the main vegetable it's built around","tier":"grab|assembly|batch","prepMinutes":20,"steps":"1-2 sentences","method":"${METHOD_SHAPE}","ingredients":[{"name":"zucchini","qty":2,"unit":"","section":"produce"}]}`;

  const text = await callClaude(prompt, { search: true });
  const parsed = extractJson(text);
  const obj = Array.isArray(parsed) ? parsed[0] : parsed;
  const snack = coerceSnack(obj || {});
  snack.url = url;
  snack.source = "url";
  return snack;
}

// Shrink a photo before sending it: Claude reads ~1568px on the long edge
// at most, and a full-size phone photo would make the request slow and large.
function photoForClaude(file, maxEdge = 1568) {
  return new Promise((resolve, reject) => {
    const src = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(src);
      const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
      resolve({ media_type: "image/jpeg", data });
    };
    img.onerror = () => { URL.revokeObjectURL(src); reject(new Error("Couldn't open that image")); };
    img.src = src;
  });
}

const MAX_PHOTOS = 4;

async function importRecipePhoto(images) {
  const prompt = `The attached photo${images.length > 1 ? "s show" : " shows"} a recipe (a cookbook page, recipe card or handwritten note).
Transcribe it faithfully, keeping the quantities so they can feed a shopping list. Don't invent ingredients that aren't shown.
If no image is attached, or it doesn't show a recipe, return {"error":"no recipe"} instead.

${JSON_RULES}

"steps" is a short summary for a card; "method" is the complete recipe for cooking from.

Shape:
{"title":"","vegetable":"the main vegetable it's built around","tier":"grab|assembly|batch","prepMinutes":20,"steps":"the method, condensed to a few sentences","method":"${METHOD_SHAPE}","ingredients":[{"name":"zucchini","qty":2,"unit":"","section":"produce"}]}`;

  const text = await callClaude(prompt, { images });
  const parsed = extractJson(text);
  const obj = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!obj || obj.error) throw new Error("No recipe found in the photo");
  const snack = coerceSnack(obj);
  snack.source = "photo";
  return snack;
}

// Remembered shopping-list sections are keyed by the plain lowercased name.
const sectionKey = (name) => String(name || "").trim().toLowerCase().replace(/\s+/g, " ");

async function sortIngredients(names) {
  const prompt = `Sort each grocery ingredient into the shopping-list section where you'd find it in a US supermarket.

${names.map((n) => `- ${n}`).join("\n")}

Return ONLY raw JSON, no commentary: an object mapping each ingredient exactly as written above to one of: produce, dairy, pantry, frozen, other.
Fresh fruit, vegetables and herbs are produce; eggs are dairy; canned, dried and shelf-stable goods are pantry; meat and fish are other unless frozen.`;

  const parsed = extractJson(await callClaude(prompt));
  const out = {};
  for (const [name, sec] of Object.entries(parsed || {})) {
    const section = String(sec || "").toLowerCase();
    if (SECTIONS.includes(section)) out[sectionKey(name)] = section;
  }
  return out;
}

// Recipes imported before the full method was kept only have the short summary.
async function fetchMethod(url) {
  const prompt = `Search the web for this recipe page and read it: ${url}

Copy out its complete method for someone cooking it right now.

Return ONLY raw JSON. No markdown fences, no commentary before or after.

Shape:
{"method":"${METHOD_SHAPE}"}`;

  const text = await callClaude(prompt, { search: true });
  const parsed = extractJson(text);
  const method = joinMethod((Array.isArray(parsed) ? parsed[0] : parsed)?.method);
  if (!method) throw new Error("No method found on that page");
  return method;
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

// One ingredient as a line of text: "2 tbsp olive oil".
function ingredientLine(i) {
  return [i.qty != null ? fmtQty(parseQty(i.qty)) : "", i.unit, i.name].filter(Boolean).join(" ");
}

// Parse "one ingredient per line" text. Lines that match an existing
// ingredient exactly keep it as-is, so unchanged items keep their section.
// New lines get a keyword guess and `guessed: true`, which the app replaces
// with a section from Claude once the recipe is saved (sortNewIngredients).
function parseIngredientLines(text, previous = []) {
  const byLine = new Map(previous.map((i) => [ingredientLine(i), i]));
  return text.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    if (byLine.has(l)) return byLine.get(l);
    const m = l.match(/^([\d./\s]+)?\s*(?:(tbsp|tsp|cups|cup|oz|lb|g|kg|can|head|slice|bunch)\b)?\s*(.+)$/i);
    const name = (m && m[3] ? m[3] : l).trim();
    return { ...ing(name, m && m[1] ? parseQty(m[1]) : null, m && m[2] ? m[2].toLowerCase() : "", guessSection(name)), guessed: true };
  });
}

/* --------------------------------------------------------------- UI bits */

function Pill({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={!!active}
      className={`min-h-[44px] px-4 rounded-full border-2 border-ink text-[13px] font-extrabold whitespace-nowrap shrink-0 ${
        active ? "bg-butter" : "bg-white"
      }`}
    >
      {children}
    </button>
  );
}

function TagChip() {
  return <span className="chip bg-mint text-mintink">{TAG_LABEL[DINNER_TAG]}</span>;
}

/* Round check used on cards and rows. `size` is the tap target. */
function CheckCircle({ on, onClick, label, size = 40 }) {
  return (
    <button
      onClick={onClick} aria-label={label} aria-pressed={!!on}
      className={`rounded-full border-2 border-ink flex items-center justify-center shrink-0 ${on ? "bg-berry text-white" : "bg-white"}`}
      style={{ width: size, height: size }}
    >
      {on && <Check size={18} strokeWidth={3} />}
    </button>
  );
}

/* Square check for list rows. The button is the 44px tap target. */
function CheckBox({ on, onClick, label }) {
  return (
    <button onClick={onClick} aria-label={label} aria-pressed={!!on}
            className="w-11 h-11 flex items-center justify-center shrink-0">
      <span className={`w-6 h-6 rounded-lg border-2 border-ink flex items-center justify-center ${on ? "bg-berry text-white" : "bg-white"}`}>
        {on && <Check size={14} strokeWidth={3.4} />}
      </span>
    </button>
  );
}

function VegDot({ veg, size = 10 }) {
  return (
    <span
      className="inline-block rounded-full shrink-0 border-[1.5px] border-ink"
      style={{ width: size, height: size, backgroundColor: vegColor(veg) }}
    />
  );
}

function ExposureMeter({ count, target = EXPOSURE_TARGET, color }) {
  const cells = [];
  for (let i = 0; i < target; i++) {
    cells.push(
      <span key={i} className="rounded-sm border border-ink" style={{
        width: 9, height: 16,
        backgroundColor: i < count ? color : "#FFFFFF",
      }} />
    );
  }
  const over = count > target ? count - target : 0;
  return (
    <span className="inline-flex items-center gap-1">
      <span className="inline-flex gap-0.5">{cells}</span>
      {over > 0 && <span className="text-xs font-bold text-muted">+{over}</span>}
    </span>
  );
}

/* A dialog centered on the screen. It scrolls inside itself when the content is
   taller than the viewport, so the header and close button stay in view. */
function Sheet({ open, onClose, title, children }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(61,43,43,0.5)" }}>
      <div role="dialog" aria-modal="true" aria-label={title}
           className="bg-blush w-full rounded-[28px] border-2 border-ink shadow-sticker-lg overflow-y-auto"
           style={{ maxWidth: 520, maxHeight: "calc(100dvh - 2rem)" }}>
        <div className="sticky top-0 z-10 bg-blush flex items-center justify-between px-5 py-3 border-b-2 border-line">
          <h2 className="font-display text-xl font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="w-11 h-11 -mr-2 flex items-center justify-center rounded-full"><X size={22} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function Empty({ icon: Icon, children, action }) {
  return (
    <div className="text-center py-12 px-6">
      <span className="w-16 h-16 mx-auto mb-4 rounded-full bg-butter border-2 border-ink shadow-sticker-sm flex items-center justify-center">
        <Icon size={28} />
      </span>
      <p className="text-[15px] font-semibold text-muted leading-relaxed">{children}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------- app */

const emptyWeek = (id) => ({
  id,
  suggestions: [],
  selected: [],
  dinners: {},   // day index (Mon = 0) -> library snack id; every planned dinner is also in `selected`
  prepped: [],
  logs: {},
  libraryOnly: false,
  checked: {},
  have: {},
  manual: [],
});

// Take a recipe out of a week entirely: chosen, prepped, and any dinner day it held.
function withoutRecipe(w, id) {
  return {
    ...w,
    dinners: Object.fromEntries(Object.entries(w.dinners || {}).filter(([, v]) => v !== id)),
    selected: w.selected.filter((x) => x !== id),
    prepped: w.prepped.filter((x) => x !== id),
  };
}

// A week's suggestions, refreshed with any library edits made since.
function poolOf(w, library) {
  const byId = new Map(library.map((s) => [s.id, s]));
  return (w.suggestions || []).map((s) => byId.get(s.id) ? { ...byId.get(s.id), _reason: s._reason } : s);
}

// The recipes chosen for a week (dinners and snacks).
function chosenOf(w, library, pool) {
  const byId = new Map([...library, ...pool].map((s) => [s.id, s]));
  return (w.selected || []).map((id) => byId.get(id)).filter(Boolean);
}

function SnackPlannerApp({ onSignOut }) {
  const [tab, setTab] = useState("week");
  const [weekMode, setWeekMode] = useState("dinners"); // "dinners" | "snacks"
  const [ready, setReady] = useState(false);
  const [storageOk, setStorageOk] = useState(true);

  const [library, setLibrary] = useState([]);
  const [weeks, setWeeks] = useState([]);
  const [exposures, setExposures] = useState({});
  const [week, setWeek] = useState(() => emptyWeek(weekStartOf()));
  const [nextWeek, setNextWeek] = useState(() => emptyWeek(nextWeekId()));
  const [listView, setListView] = useState(loadListView); // shopping list filters, per device
  const [planWhich, setPlanWhich] = useState("this"); // which week the Week tab (and Library buttons) plan: "this" | "next"
  const [pantry, setPantry] = useState([]);
  const [sectionMemory, setSectionMemory] = useState({}); // ingredient name -> section, learned from Claude
  const [cooking, setCooking] = useState(loadCooking); // { id, startedAt } while a recipe is being cooked

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
      const storedNext = await loadKey(KEY_NEXT, null);
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
          firstRun.current = false; // the archived week is new, so save it straight away
        }
        cur = null;
      }
      // Next week's plan, made ahead, becomes this week once its Monday arrives.
      if (!cur && storedNext && storedNext.id === thisWeekId) cur = { ...emptyWeek(thisWeekId), ...storedNext };
      const nextId = nextWeekId(thisWeekId);
      const nxt = storedNext && storedNext.id === nextId ? { ...emptyWeek(nextId), ...storedNext } : emptyWeek(nextId);

      setLibrary(lib);
      setWeeks(wks);
      setExposures(core?.exposures || computeExposures(wks));
      setWeek(cur || emptyWeek(thisWeekId));
      setNextWeek(nxt);
      setPantry(Array.isArray(have) ? have : []);
      setSectionMemory(core?.sections || {});
      setReady(true);
    })();
    return () => { cancelled = true; };
  }, []);

  /* ------- persist ------- */
  const firstRun = useRef(true);
  useEffect(() => {
    if (!ready) return;
    // The first run after loading would only re-save what was just loaded, unless
    // the load archived last week (see the rollover above), which must be saved.
    if (firstRun.current) { firstRun.current = false; return; }
    saveKey(KEY_CORE, { library, weeks, exposures, sections: sectionMemory });
  }, [library, weeks, exposures, sectionMemory, ready]);

  useEffect(() => { if (ready) saveKey(KEY_WEEK, week); }, [week, ready]);
  useEffect(() => { if (ready) saveKey(KEY_NEXT, nextWeek); }, [nextWeek, ready]);
  useEffect(() => { if (ready) saveKey(KEY_HAVE, pantry); }, [pantry, ready]);

  // A session whose recipe has since been deleted can't be finished; drop it.
  useEffect(() => {
    if (ready && cooking && !library.some((s) => s.id === cooking.id)) cookLater();
  }, [ready, cooking, library]);

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

  // The week being planned on the Week tab. Cooking, prepping and rating always
  // apply to this week; next week can only be planned.
  const isNext = planWhich === "next";
  const plan = isNext ? nextWeek : week;
  const setPlan = isNext ? setNextWeek : setWeek;

  const suggestionPool = useMemo(() => poolOf(week, library), [week.suggestions, library]);
  const nextPool = useMemo(() => poolOf(nextWeek, library), [nextWeek.suggestions, library]);
  const planPool = isNext ? nextPool : suggestionPool;

  const selectedSnacks = useMemo(() => chosenOf(week, library, suggestionPool), [week.selected, library, suggestionPool]);
  const nextSelected = useMemo(() => chosenOf(nextWeek, library, nextPool), [nextWeek.selected, library, nextPool]);
  const planSelected = isNext ? nextSelected : selectedSnacks;

  // Tagged recipes are dinners; everything else is a snack. Snack suggestions never include dinners.
  const dinnerLibrary = useMemo(() => library.filter((s) => hasTag(s, DINNER_TAG)), [library]);
  const snackLibrary = useMemo(() => library.filter((s) => !hasTag(s, DINNER_TAG)), [library]);
  const plannedCount = DINNER_DAYS.filter((d) => library.some((s) => s.id === plan.dinners?.[d])).length;
  const snackCount = planSelected.filter((s) => !hasTag(s, DINNER_TAG)).length;

  async function buildWeek({ append = false } = {}) {
    setError(null);
    const week = plan, setWeek = setPlan; // suggestions go to the week being planned
    const libOnly = week.libraryOnly;
    const existing = append ? (week.suggestions || []) : [];
    const exclude = new Set(existing.map((s) => s.id));
    const total = 6;
    const need = append ? 3 : total;

    if (libOnly) {
      const picks = pickFromLibrary(snackLibrary, week.id, need, exclude);
      setWeek((w) => ({ ...w, suggestions: [...existing, ...picks] }));
      if (!picks.length) setError("Everything in the library was made too recently. Turn off library-only or add a recipe.");
      return;
    }

    const libCount = Math.ceil(need / 2);
    const picks = pickFromLibrary(snackLibrary, week.id, libCount, exclude);
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
    setPlan((w) => {
      const has = w.selected.includes(snack.id);
      return { ...w, selected: has ? w.selected.filter((x) => x !== snack.id) : [...w.selected, snack.id],
               prepped: has ? w.prepped.filter((x) => x !== snack.id) : w.prepped };
    });
    // A generated idea earns its place in the library the moment it's chosen.
    if (!library.some((s) => s.id === snack.id) && !plan.selected.includes(snack.id)) {
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

  /* ------- cooking ------- */

  function startCooking(id) {
    const c = { id, startedAt: Date.now() };
    saveCooking(c);
    setCooking(c);
  }

  // "Cook later" drops the start time; only a start-to-finish session is timed.
  function cookLater() {
    saveCooking(null);
    setCooking(null);
  }

  // "Finished" records the session's length on the recipe and marks it cooked.
  function finishCooking() {
    if (!cooking) return;
    const seconds = Math.max(1, Math.round((Date.now() - cooking.startedAt) / 1000));
    const { id } = cooking;
    setLibrary((lib) => lib.map((s) => (s.id === id ? { ...s, cookTimes: [...(s.cookTimes || []), seconds] } : s)));
    setWeek((w) => (w.prepped.includes(id) ? w : { ...w, prepped: [...w.prepped, id] }));
    saveCooking(null);
    setCooking(null);
    flash(`Cooked in ${Math.max(1, Math.round(seconds / 60))} min`);
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
    sortNewIngredients(snack.id, snack.ingredients);
  }

  // Hand-typed ingredients start with a keyword guess. Replace it with a
  // remembered section, or ask Claude once for names it hasn't seen. If
  // Claude can't be reached, the keyword guess stays.
  async function sortNewIngredients(snackId, ingredients) {
    const fresh = (ingredients || []).filter((i) => i.guessed);
    if (!fresh.length) return;
    const unknown = [...new Set(fresh.map((i) => i.name).filter((n) => !sectionMemory[sectionKey(n)]))];
    let learned = {};
    if (unknown.length) {
      try {
        learned = await sortIngredients(unknown);
        setSectionMemory((m) => ({ ...m, ...learned }));
      } catch (e) {
        console.error("sortIngredients failed", e);
      }
    }
    const lookup = { ...sectionMemory, ...learned };
    setLibrary((lib) => lib.map((s) => s.id !== snackId ? s : {
      ...s,
      ingredients: (s.ingredients || []).map((i) => {
        if (!i.guessed) return i;
        const { guessed, ...rest } = i;
        const section = lookup[sectionKey(i.name)];
        return section ? { ...rest, section } : rest;
      }),
    }));
  }

  function toggleLibraryTag(id, tag) {
    setLibrary((lib) => lib.map((s) => {
      if (s.id !== id) return s;
      const tags = s.tags || [];
      return { ...s, tags: tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag] };
    }));
  }

  // Edits flow to the Week tab too, since suggestions are looked up by id.
  function updateLibrarySnack(id, patch) {
    setLibrary((lib) => lib.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    flash("Saved changes");
    sortNewIngredients(id, patch.ingredients);
  }

  // Pin a specific library snack to this week, and show it on the Week tab even
  // if it wasn't among the suggestions. Tapping again takes it back out.
  function toggleInWeek(snack) {
    const inWeek = plan.selected.includes(snack.id);
    const which = isNext ? "next week" : "this week";
    setPlan((w) => {
      if (inWeek) return withoutRecipe(w, snack.id);
      const shown = w.suggestions.some((s) => s.id === snack.id);
      return {
        ...w,
        selected: [...w.selected, snack.id],
        suggestions: shown ? w.suggestions : [{ ...snack, _reason: "Added from library" }, ...w.suggestions],
      };
    });
    flash(inWeek ? `Removed ${snack.title} from ${which}` : `Added ${snack.title} to ${which}`);
  }

  /* ------- dinners ------- */

  // Put a dinner on a day (replacing whatever was there). It joins `selected` so
  // the shopping list and Log pick it up like any other chosen recipe.
  function assignDinner(day, snack) {
    setPlan((w) => {
      const dinners = { ...(w.dinners || {}), [day]: snack.id };
      const prev = (w.dinners || {})[day];
      let next = { ...w, dinners };
      if (!next.selected.includes(snack.id)) next = { ...next, selected: [...next.selected, snack.id] };
      if (prev && prev !== snack.id && !Object.values(dinners).includes(prev)) {
        next = { ...next, selected: next.selected.filter((x) => x !== prev), prepped: next.prepped.filter((x) => x !== prev) };
      }
      return next;
    });
  }

  function clearDinner(day) {
    setPlan((w) => {
      const prev = (w.dinners || {})[day];
      if (!prev) return w;
      const dinners = { ...w.dinners };
      delete dinners[day];
      return Object.values(dinners).includes(prev)
        ? { ...w, dinners }
        : { ...w, dinners, selected: w.selected.filter((x) => x !== prev), prepped: w.prepped.filter((x) => x !== prev) };
    });
  }

  // Empty every weekday. The dinners also leave the week's chosen and cooked lists;
  // ratings already logged stay in History and on the recipes.
  function clearDinnersWeek() {
    setPlan((w) => {
      const ids = new Set(Object.values(w.dinners || {}));
      return {
        ...w,
        dinners: {},
        selected: w.selected.filter((x) => !ids.has(x)),
        prepped: w.prepped.filter((x) => !ids.has(x)),
      };
    });
    flash(isNext ? "Cleared next week's dinners" : "Cleared the week's dinners");
  }

  // Fill every empty weekday from the library's dinners, using the same cooldown and
  // variety rules as snack suggestions.
  function fillDinners() {
    const week = plan, setWeek = setPlan;
    const dinners = week.dinners || {};
    const empty = DINNER_DAYS.filter((d) => !library.some((s) => s.id === dinners[d]));
    const planned = new Set(Object.values(dinners));
    const picks = pickFromLibrary(dinnerLibrary, week.id, empty.length, planned);
    if (!picks.length) {
      setError("No dinners left to suggest. Everything tagged Weekday dinner is already planned or was made too recently. Add more dinners to the library.");
      return;
    }
    setError(null);
    setWeek((w) => {
      const next = { ...(w.dinners || {}) };
      const selected = [...w.selected];
      empty.slice(0, picks.length).forEach((day, i) => {
        next[day] = picks[i].id;
        if (!selected.includes(picks[i].id)) selected.push(picks[i].id);
      });
      return { ...w, dinners: next, selected };
    });
    flash(picks.length < empty.length ? `Filled ${picks.length} of ${empty.length} empty days` : "Filled the empty days");
  }

  function removeFromLibrary(id) {
    setLibrary((lib) => lib.filter((s) => s.id !== id));
    const drop = (w) => ({ ...withoutRecipe(w, id), suggestions: w.suggestions.filter((s) => s.id !== id) });
    setWeek(drop);
    setNextWeek(drop);
  }

  const needsLogging = useMemo(
    () => week.prepped.filter((id) => !week.logs?.[id]).length,
    [week.prepped, week.logs]
  );

  const shopLists = [
    { id: "this", label: "This week", snacks: selectedSnacks, week, setWeek },
    { id: "next", label: "Next week", snacks: nextSelected, week: nextWeek, setWeek: setNextWeek },
  ];

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-blush">
        <Loader2 className="animate-spin text-muted" size={22} />
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
    <div className="min-h-screen bg-blush text-ink">
      <div className="mx-auto pb-32" style={{ maxWidth: 560 }}>

        <header className="px-5 pt-7 pb-4">
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="text-[13px] font-extrabold text-muted mb-1.5">
                {prettyWeek(tab === "week" || tab === "library" ? plan.id : week.id)}
                <button onClick={onSignOut} className="ml-3 text-xs font-bold underline">Sign out</button>
              </div>
              <h1 className="font-display text-[34px] leading-none font-semibold tracking-tight">
                {tab === "week" && "Our week"}
                {tab === "list" && "Shopping list"}
                {tab === "log" && "How'd it go?"}
                {tab === "library" && "Library"}
                {tab === "history" && "History"}
              </h1>
            </div>
            {tab === "week" && weekMode === "dinners" && (
              <span className="rounded-full bg-butter border-2 border-ink shadow-sticker-sm px-3 py-1.5 text-[13px] font-extrabold whitespace-nowrap">
                {plannedCount} of {DINNER_DAYS.length} planned
              </span>
            )}
            {tab === "week" && weekMode === "snacks" && snackCount > 0 && (
              <span className="rounded-full bg-butter border-2 border-ink shadow-sticker-sm px-3 py-1.5 text-[13px] font-extrabold whitespace-nowrap">
                {snackCount} snack{snackCount === 1 ? "" : "s"} chosen
              </span>
            )}
            {tab === "list" && shopLists.some((l) => listView.show.includes(l.id) && hasListItems(l)) && (
              <button onClick={() => copyList(shopLists, listView, pantry, flash)} className="btn-plain shadow-sticker-sm text-sm shrink-0">
                <Copy size={15} /> Copy
              </button>
            )}
            {tab === "log" && needsLogging > 0 && (
              <span className="rounded-full bg-butter border-2 border-ink shadow-sticker-sm px-3 py-1.5 text-[13px] font-extrabold whitespace-nowrap">
                {needsLogging} to rate
              </span>
            )}
          </div>
        </header>

        {!storageOk && (
          <div className="mx-5 mb-3 rounded-2xl border-2 border-ink bg-butter px-4 py-3 text-sm font-bold">
            Supabase isn't configured, so nothing will be saved between visits. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.
          </div>
        )}

        {error && (
          <div className="mx-5 mb-3 rounded-2xl border-2 border-ink bg-peach px-4 py-3 text-sm font-bold flex items-start gap-2">
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} aria-label="Dismiss" className="w-8 h-8 -m-1 flex items-center justify-center"><X size={16} /></button>
          </div>
        )}

        {tab === "week" && (
          <WeekView
            mode={weekMode} setMode={setWeekMode}
            planWhich={planWhich} setPlanWhich={setPlanWhich}
            week={plan} setWeek={setPlan} pool={planPool} busy={busy}
            library={library} dinnerLibrary={dinnerLibrary}
            onBuild={buildWeek} onToggleSelect={toggleSelected} onTogglePrepped={togglePrepped}
            onStartCooking={isNext ? null : startCooking}
            onAssignDinner={assignDinner} onClearDinner={clearDinner} onFillDinners={fillDinners}
            onClearDinnersWeek={clearDinnersWeek}
            onGoToLibrary={() => setTab("library")}
            selectedCount={plan.selected.length} onGoToList={() => setTab("list")}
          />
        )}

        {tab === "list" && (
          <ShoppingView
            lists={shopLists} view={listView} setView={setListView}
            pantry={pantry} setPantry={setPantry}
            onGoToWeek={(which) => { if (which === "this" || which === "next") setPlanWhich(which); setTab("week"); }}
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
            library={library} onAdd={addToLibrary} onRemove={removeFromLibrary} onUpdate={updateLibrarySnack}
            week={plan} isNext={isNext} selectedIds={plan.selected} onToggleInWeek={toggleInWeek} onToggleTag={toggleLibraryTag}
            onAssignDinner={assignDinner} onCookNow={startCooking}
            busy={busy} setBusy={setBusy} flash={flash}
          />
        )}

        {tab === "history" && (
          <HistoryView weeks={weeks} exposures={exposures} library={library} />
        )}
      </div>

      {cooking && library.some((s) => s.id === cooking.id) && (
        <CookingScreen
          snack={library.find((s) => s.id === cooking.id)} startedAt={cooking.startedAt}
          onFinish={finishCooking} onLater={cookLater} onSaveMethod={updateLibrarySnack}
        />
      )}

      {toast && (
        <div className="fixed left-0 right-0 flex justify-center z-[70] px-5" style={{ bottom: 100 }}>
          <div className="px-4 py-2.5 rounded-full text-sm font-bold bg-ink text-white shadow-sticker">
            {toast}
          </div>
        </div>
      )}

      <nav className="fixed bottom-0 left-0 right-0 px-5 pb-4 z-30 pointer-events-none">
        <div className="mx-auto flex items-center gap-0.5 p-1.5 rounded-[28px] bg-ink pointer-events-auto" style={{ maxWidth: 520 }}>
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button key={t.id} onClick={() => setTab(t.id)}
                      aria-label={t.label} aria-current={active ? "page" : undefined}
                      className={`relative min-h-[48px] rounded-[22px] flex items-center justify-center gap-1.5 ${
                        active ? "flex-[1.6] bg-peach text-ink" : "flex-1 text-blush"
                      }`}>
                <Icon size={active ? 20 : 22} strokeWidth={active ? 2.2 : 1.9} />
                {active && <span className="font-display text-sm font-semibold">{t.label}</span>}
                {t.badge > 0 && (
                  <span className="absolute -top-1 right-1 rounded-full bg-berry text-white border-2 border-ink flex items-center justify-center text-[10px] font-extrabold"
                        style={{ minWidth: 20, height: 20 }}>
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

function WeekView({
  mode, setMode, planWhich, setPlanWhich, week, setWeek, pool, busy, library, dinnerLibrary,
  onBuild, onToggleSelect, onTogglePrepped, onStartCooking, onAssignDinner, onClearDinner, onFillDinners,
  onClearDinnersWeek, onGoToLibrary, selectedCount, onGoToList,
}) {
  const isNext = planWhich === "next";
  return (
    <div>
      <div className="px-5 mb-3 flex gap-2">
        {[["this", "This week"], ["next", "Next week"]].map(([id, label]) => (
          <Pill key={id} active={planWhich === id} onClick={() => setPlanWhich(id)}>{label}</Pill>
        ))}
      </div>
      <div className="px-5 mb-4">
        <div className="flex p-[3px] bg-white border-2 border-ink rounded-[18px] shadow-sticker">
          {[["dinners", "Dinners"], ["snacks", "Snacks"]].map(([id, label]) => (
            <button key={id} onClick={() => setMode(id)} aria-pressed={mode === id}
                    className={`flex-1 min-h-[44px] rounded-[14px] font-display text-base font-semibold ${
                      mode === id ? "bg-berry text-white" : "text-ink"
                    }`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {mode === "dinners" ? (
        <DinnersView
          week={week} isNext={isNext} library={library} dinnerLibrary={dinnerLibrary}
          onAssign={onAssignDinner} onClear={onClearDinner} onFill={onFillDinners}
          onClearWeek={onClearDinnersWeek}
          onTogglePrepped={onTogglePrepped} onStartCooking={onStartCooking} onGoToLibrary={onGoToLibrary}
        />
      ) : (
        <SnacksView
          week={week} isNext={isNext} setWeek={setWeek} pool={pool} library={library} busy={busy}
          onBuild={onBuild} onToggleSelect={onToggleSelect} onTogglePrepped={onTogglePrepped}
          onStartCooking={onStartCooking}
        />
      )}

      {selectedCount > 0 && (
        <div className="px-5">
          <button
            onClick={onGoToList}
            className="sticker w-full mt-4 min-h-[56px] px-4 font-display text-base font-semibold flex items-center gap-2.5"
          >
            <ShoppingBasket size={22} />
            <span className="flex-1 text-left">See the shopping list</span>
            <ChevronRight size={20} />
          </button>
        </div>
      )}
    </div>
  );
}

/* ---- dinners: Tonight card, one tile per weekday, and a picker */

const TILE_BG = ["bg-peach", "bg-mint", "bg-butter"];

function DinnersView({ week, isNext, library, dinnerLibrary, onAssign, onClear, onFill, onClearWeek, onTogglePrepped, onStartCooking, onGoToLibrary }) {
  const [pickDay, setPickDay] = useState(null); // weekday being filled or swapped
  const [confirmClear, setConfirmClear] = useState(false);
  const byId = useMemo(() => new Map(library.map((s) => [s.id, s])), [library]);
  const dinners = week.dinners || {};
  const dinnerOf = (d) => byId.get(dinners[d]) || null;

  const today = todayIndex();
  // Next week has no "tonight": every day is a tile, and nothing can be marked cooked yet.
  const tonight = !isNext && DINNER_DAYS.includes(today) ? today : null;
  const tileDays = DINNER_DAYS.filter((d) => d !== tonight);
  const emptyCount = DINNER_DAYS.filter((d) => !dinnerOf(d)).length;
  const plannedCount = DINNER_DAYS.length - emptyCount;

  function cookedNote(s) {
    const v = week.logs?.[s.id];
    return v ? <span className={`chip text-ink ${VERDICTS[v].bg}`}>{VERDICTS[v].label}</span> : null;
  }

  return (
    <div className="px-5">
      {!dinnerLibrary.length && (
        <div className="sticker bg-butter p-4 mb-4">
          <p className="text-[15px] font-bold leading-relaxed">
            Dinners come from your library. Add a recipe and tag it Weekday dinner, then plan it here.
          </p>
          <button onClick={onGoToLibrary} className="btn-primary mt-3">Open the library</button>
        </div>
      )}

      {!!dinnerLibrary.length && emptyCount > 0 && (
        <button onClick={onFill} className="btn-plain shadow-sticker-sm w-full mb-4">
          <Sparkles size={16} /> Fill empty days from my library
        </button>
      )}

      {tonight !== null && (() => {
        const s = dinnerOf(tonight);
        const info = dayInfo(week.id, tonight);
        const cooked = !!s && week.prepped.includes(s.id);
        if (!s) {
          return (
            <article className="sticker bg-butter shadow-sticker-lg p-3.5 mb-4 flex flex-col gap-3">
              <span className="self-start bg-white border-2 border-ink rounded-full px-3 py-0.5 font-display text-sm font-semibold">
                Tonight · {info.short} {info.date}
              </span>
              <h2 className="font-display text-2xl font-semibold leading-tight">Nothing planned for tonight</h2>
              <button onClick={() => setPickDay(tonight)} className="btn-primary w-full">Pick a dinner</button>
            </article>
          );
        }
        return (
          <article className="sticker bg-butter shadow-sticker-lg p-3.5 mb-4 flex flex-col gap-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="bg-white border-2 border-ink rounded-full px-3 py-0.5 font-display text-sm font-semibold">
                Tonight · {info.short} {info.date}
              </span>
              <TagChip />
            </div>
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <h2 className="font-display text-2xl font-semibold leading-tight">{s.title}</h2>
                <div className="flex items-center gap-2 flex-wrap mt-1.5 text-xs font-extrabold">
                  {!!cookMinutes(s) && <span className="inline-flex items-center gap-1"><Clock size={12} /> {cookMinutes(s)} min</span>}
                  {cookedNote(s)}
                </div>
              </div>
              <svg width="64" height="64" viewBox="0 0 64 64" fill="none" stroke="#3D2B2B" strokeWidth="2.2"
                   strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
                <circle cx="32" cy="32" r="27" fill="#FFFFFF" /><circle cx="32" cy="32" r="17" />
                <path d="M26 35c0-6 4-10 10-10 0 6-4 10-10 10z" fill="#9BCFA8" /><path d="M26 35l7-7" />
              </svg>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setPickDay(tonight)} className="btn-plain flex-1">Swap dinner</button>
              {cooked ? (
                <button onClick={() => onTogglePrepped(s.id)} aria-pressed className="btn bg-white text-ink flex-1">
                  <Check size={16} strokeWidth={3} /> Cooked
                </button>
              ) : (
                <button onClick={() => onStartCooking(s.id)} className="btn-primary flex-1">Start Cooking</button>
              )}
            </div>
          </article>
        );
      })()}

      <div className="grid grid-cols-2 gap-3">
        {tileDays.map((d) => {
          const s = dinnerOf(d);
          const info = dayInfo(week.id, d);
          if (!s) {
            return (
              <button key={d} onClick={() => setPickDay(d)} aria-label={`Add a dinner for ${info.long}`}
                      className="min-h-[148px] border-2 border-dashed border-dim rounded-[22px] p-2.5 pl-3 flex flex-col items-start gap-1.5 text-left">
                <span className="bg-white border-2 border-ink rounded-full px-2.5 py-0.5 font-display text-sm font-semibold">
                  {info.short} {info.date}
                </span>
                <span className="m-auto flex flex-col items-center gap-1.5 font-display text-[15px] font-semibold">
                  <span className="w-10 h-10 rounded-full bg-berry text-white flex items-center justify-center">
                    <Plus size={20} strokeWidth={2.6} />
                  </span>
                  Add a dinner
                </span>
              </button>
            );
          }
          const cooked = !isNext && week.prepped.includes(s.id);
          return (
            <article key={d}
                     className={`min-h-[148px] border-2 border-ink rounded-[22px] shadow-sticker p-2.5 pl-3 flex flex-col gap-1.5 ${cooked ? "bg-white" : TILE_BG[d % TILE_BG.length]}`}>
              <div className="flex items-center justify-between">
                <span className={`border-2 border-ink rounded-full px-2.5 py-0.5 font-display text-sm font-semibold ${cooked ? "bg-peach" : "bg-white"}`}>
                  {info.short} {info.date}
                </span>
                {!isNext && (
                  <CheckCircle on={cooked} onClick={() => onTogglePrepped(s.id)} size={40}
                               label={cooked ? `Unmark ${info.long} dinner as cooked` : `Mark ${info.long} dinner as cooked`} />
                )}
              </div>
              <button onClick={() => setPickDay(d)} aria-label={`${s.title}, ${info.long}. Change dinner`}
                      className="text-left font-display text-[15px] font-semibold leading-tight">
                {s.title}
              </button>
              <div className="mt-auto text-xs font-extrabold flex items-center gap-1.5 flex-wrap">
                {cookedNote(s) || (!!cookMinutes(s) && <span>{cookMinutes(s)} min</span>)}
              </div>
            </article>
          );
        })}
      </div>

      {plannedCount > 0 && (
        confirmClear ? (
          <div className="sticker bg-peach p-3.5 mt-4">
            <p className="text-[15px] font-bold">
              Clear {plannedCount === 1 ? "the planned dinner" : `all ${plannedCount} planned dinners`}?
            </p>
            <div className="flex gap-2 mt-3">
              <button onClick={() => setConfirmClear(false)} className="btn-plain flex-1">Keep them</button>
              <button onClick={() => { onClearWeek(); setConfirmClear(false); }} className="btn-primary flex-1">
                {isNext ? "Clear next week" : "Clear week"}
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setConfirmClear(true)}
                  className="mt-4 w-full min-h-[48px] rounded-[18px] border-2 border-dashed border-dim font-display text-[15px] font-semibold flex items-center justify-center gap-1.5">
            <Trash2 size={16} /> {isNext ? "Clear next week" : "Clear week"}
          </button>
        )
      )}

      <Sheet
        open={pickDay !== null} onClose={() => setPickDay(null)}
        title={pickDay === null ? "" : `Dinner for ${dayInfo(week.id, pickDay).long}`}
      >
        {pickDay !== null && (
          <DinnerPicker
            dinners={dinnerLibrary} week={week} day={pickDay} current={dinnerOf(pickDay)}
            onPick={(s) => { onAssign(pickDay, s); setPickDay(null); }}
            onClear={() => { onClear(pickDay); setPickDay(null); }}
            onGoToLibrary={() => { setPickDay(null); onGoToLibrary(); }}
          />
        )}
      </Sheet>
    </div>
  );
}

function DinnerPicker({ dinners, week, day, current, onPick, onClear, onGoToLibrary }) {
  if (!dinners.length) {
    return (
      <div className="text-center">
        <p className="text-[15px] font-bold text-muted leading-relaxed">
          No dinners in the library yet. Add a recipe and tag it Weekday dinner.
        </p>
        <button onClick={onGoToLibrary} className="btn-primary mt-4">Open the library</button>
      </div>
    );
  }

  // Dinners already planned on another day sink to the bottom.
  const plannedDay = (id) => DINNER_DAYS.find((d) => (week.dinners || {})[d] === id);
  const sorted = [...dinners].sort((a, b) => {
    const pa = plannedDay(a.id) != null ? 1 : 0;
    const pb = plannedDay(b.id) != null ? 1 : 0;
    return pa - pb || a.title.localeCompare(b.title);
  });

  return (
    <div className="space-y-2.5">
      {sorted.map((s) => {
        const pd = plannedDay(s.id);
        const isCurrent = current && current.id === s.id;
        const last = lastVerdict(s);
        return (
          <button key={s.id} onClick={() => onPick(s)}
                  className={`sticker w-full text-left px-4 py-3 flex items-center gap-3 ${isCurrent ? "bg-mint" : ""}`}>
            <div className="flex-1 min-w-0">
              <span className="font-display text-base font-semibold leading-tight block">{s.title}</span>
              <span className="flex items-center gap-2 flex-wrap mt-1 text-xs font-extrabold">
                {!!cookMinutes(s) && <span>{cookMinutes(s)} min</span>}
                {last && <span style={{ color: VERDICTS[last].tone }}>{VERDICTS[last].label.toLowerCase()} last time</span>}
                {s.lastMadeWeek && <span className="text-muted">made week of {prettyWeek(s.lastMadeWeek)}</span>}
              </span>
            </div>
            {isCurrent
              ? <Check size={20} strokeWidth={3} />
              : pd != null && <span className="chip bg-butter">{dayInfo(week.id, pd).short}</span>}
          </button>
        );
      })}
      {current && (
        <button onClick={onClear} className="btn-plain w-full mt-2">
          Clear {dayInfo(week.id, day).long}
        </button>
      )}
    </div>
  );
}

/* ---- snacks: the suggestion list */

function SnacksView({ week, isNext, setWeek, pool: allPool, library, busy, onBuild, onToggleSelect, onTogglePrepped, onStartCooking }) {
  const pool = allPool.filter((s) => !hasTag(s, DINNER_TAG));
  const [tierFilter, setTierFilter] = useState([]);
  const [chosenOnly, setChosenOnly] = useState(false);

  // Every snack chosen this week, even one a later "New set" dropped from the suggestions.
  const chosen = useMemo(() => {
    const byId = new Map([...library, ...allPool].map((s) => [s.id, s]));
    return week.selected.map((id) => byId.get(id)).filter((s) => s && !hasTag(s, DINNER_TAG));
  }, [week.selected, library, allPool]);

  const base = chosenOnly ? chosen : pool;
  const shown = base.filter((s) => !tierFilter.length || tierFilter.includes(s.tier));

  function toggleTier(t) {
    setTierFilter((f) => (f.includes(t) ? f.filter((x) => x !== t) : [...f, t]));
  }

  return (
    <div className="px-5">
      <div className="flex items-center justify-between gap-3 mb-4">
        <button
          onClick={() => setWeek((w) => ({ ...w, libraryOnly: !w.libraryOnly }))}
          role="switch" aria-checked={!!week.libraryOnly}
          className="min-h-[44px] flex items-center gap-2 text-sm font-extrabold"
        >
          <span
            className={`rounded-full border-2 border-ink flex items-center p-0.5 transition-colors ${week.libraryOnly ? "bg-berry justify-end" : "bg-peach justify-start"}`}
            style={{ width: 46, height: 28 }}
          >
            <span className="bg-white rounded-full border-2 border-ink block" style={{ width: 20, height: 20 }} />
          </span>
          Library only
        </button>

        <button
          onClick={() => onBuild({ append: false })}
          disabled={busy === "ideas"}
          className="btn-primary"
          style={{ opacity: busy === "ideas" ? 0.6 : 1 }}
        >
          {busy === "ideas" ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          {pool.length ? "New set" : "Suggest snacks"}
        </button>
      </div>

      {(pool.length > 0 || chosen.length > 0) && (
        <div className="flex gap-2 mb-4 overflow-x-auto py-1 -mx-5 px-5">
          <Pill active={chosenOnly} onClick={() => setChosenOnly((v) => !v)}>
            Chosen ({chosen.length})
          </Pill>
          {TIER_ORDER.map((t) => (
            <Pill key={t} active={tierFilter.includes(t)} onClick={() => toggleTier(t)}>
              {TIERS[t].label}
            </Pill>
          ))}
        </div>
      )}

      {!base.length && (
        <Empty icon={Carrot}>
          {chosenOnly
            ? `No snacks chosen for ${isNext ? "next" : "this"} week yet. Turn off the Chosen filter and tick the ones you want.`
            : "Nothing planned yet. Suggestions pull half from your library and half from new ideas, skipping anything you made in the last few weeks."}
        </Empty>
      )}

      <div className="space-y-3.5">
        {shown.map((s) => (
          <SnackCard
            key={s.id} snack={s}
            selected={week.selected.includes(s.id)}
            prepped={week.prepped.includes(s.id)}
            onSelect={() => onToggleSelect(s)}
            onPrepped={() => onTogglePrepped(s.id)}
            onStartCooking={onStartCooking && (() => onStartCooking(s.id))}
          />
        ))}
      </div>

      {busy === "ideas" && (
        <div className="flex items-center gap-2 justify-center py-6 text-sm font-bold text-muted">
          <Loader2 size={16} className="animate-spin" /> Thinking up new ideas
        </div>
      )}

      {pool.length > 0 && !chosenOnly && busy !== "ideas" && (
        <button
          onClick={() => onBuild({ append: true })}
          className="w-full mt-4 min-h-[48px] rounded-[18px] border-2 border-dashed border-dim font-display text-[15px] font-semibold flex items-center justify-center gap-1.5"
        >
          <Plus size={16} /> More ideas
        </button>
      )}

    </div>
  );
}

function SnackCard({ snack, selected, prepped, onSelect, onPrepped, onStartCooking }) {
  const [open, setOpen] = useState(false);
  const avg = avgScore(snack);
  const last = lastVerdict(snack);

  return (
    <div className={`border-2 border-ink rounded-[22px] shadow-sticker ${selected ? "bg-mint" : "bg-white"}`}>
      <div className="flex items-start gap-3 p-3.5">
        <CheckCircle on={selected} onClick={onSelect}
                     label={selected ? `Remove ${snack.title} from this week` : `Choose ${snack.title}`} />

        <div className="flex-1 min-w-0">
          <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="text-left w-full">
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-display text-base font-semibold leading-tight">{snack.title}</h3>
              {open ? <ChevronDown size={18} className="shrink-0 mt-0.5" />
                    : <ChevronRight size={18} className="shrink-0 mt-0.5" />}
            </div>
            <div className="flex items-center gap-2 flex-wrap mt-1.5 text-xs font-extrabold">
              <span className="inline-flex items-center gap-1.5">
                <VegDot veg={snack.vegetable} /> {snack.vegetable}
              </span>
              <span>·</span>
              <span className="inline-flex items-center gap-1">
                <Clock size={12} />
                {snack.tier === "grab" ? "grab and go"
                  : cookMinutes(snack) ? `${cookMinutes(snack)} min` : (TIERS[snack.tier]?.label.toLowerCase() || "no prep time")}
              </span>
              {hasTag(snack, DINNER_TAG) && <TagChip />}
              {last && (
                <>
                  <span>·</span>
                  <span style={{ color: VERDICTS[last].tone }}>{VERDICTS[last].label.toLowerCase()} last time</span>
                </>
              )}
            </div>
            {snack._reason && (
              <p className="text-xs font-extrabold mt-2 inline-flex items-center gap-1 chip bg-butter">
                <Sparkles size={12} /> {snack._reason}
              </p>
            )}
            {!snack._reason && last === "refused" && (
              <p className="text-xs font-bold mt-1.5 text-muted">
                Back for another go — it can take ten tries.
              </p>
            )}
          </button>

          {open && (
            <div className="mt-3">
              {snack.steps && <p className="text-[13px] font-semibold leading-relaxed">{snack.steps}</p>}
              {!!(snack.ingredients || []).length && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {snack.ingredients.map((i, n) => (
                    <span key={n} className="chip bg-white">{ingredientLine(i)}</span>
                  ))}
                </div>
              )}
              {snack.url && (
                <a href={snack.url} target="_blank" rel="noreferrer"
                   className="inline-flex items-center gap-1 text-xs font-extrabold mt-2 underline">
                  <Link2 size={12} /> recipe
                </a>
              )}
            </div>
          )}

          {selected && onStartCooking && (prepped ? (
            <button onClick={onPrepped} aria-pressed className="btn mt-3 w-full text-sm bg-berry text-white shadow-sticker-sm">
              <Check size={15} strokeWidth={3} /> Prepped
            </button>
          ) : (
            <button onClick={onStartCooking} className="btn mt-3 w-full text-sm bg-white text-ink">Start Cooking</button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------- cooking screen */

// Full-screen recipe with the ingredients first. The only ways out are Finished
// (records the time) and Cook Later (forgets the start).
function CookingScreen({ snack, startedAt, onFinish, onLater, onSaveMethod }) {
  const [now, setNow] = useState(Date.now());
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const stepLines = (snack.method || "").split("\n")
    .map((l) => l.replace(/^\s*(?:step\s*)?\d+\s*[.):-]\s+/i, "").trim())
    .filter(Boolean);

  async function loadFull() {
    setLoading(true);
    setErr(null);
    try {
      onSaveMethod(snack.id, { method: await fetchMethod(snack.url) });
    } catch (e) {
      setErr(`Couldn't load the full recipe (${e.message}).`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] bg-blush overflow-y-auto" role="dialog" aria-modal="true" aria-label={`Cooking ${snack.title}`}>
      <div className="mx-auto px-5 pt-6 pb-40" style={{ maxWidth: 560 }}>
        <div className="flex items-center justify-between gap-3 mb-3">
          <span className="rounded-full bg-butter border-2 border-ink shadow-sticker-sm px-3 py-1.5 text-[13px] font-extrabold inline-flex items-center gap-1.5">
            <Clock size={14} /> <span className="tabular-nums">{fmtClock(now - startedAt)}</span>
          </span>
          {!!cookMinutes(snack) && <span className="text-xs font-extrabold text-muted">usually {cookMinutes(snack)} min</span>}
        </div>
        <h1 className="font-display text-[30px] leading-tight font-semibold">{snack.title}</h1>

        <h2 className="font-display text-xl font-semibold mt-6 mb-2">Ingredients</h2>
        {(snack.ingredients || []).length ? (
          <ul className="sticker p-4 space-y-2">
            {snack.ingredients.map((i, n) => (
              <li key={n} className="text-[15px] font-bold leading-snug">{ingredientLine(i)}</li>
            ))}
          </ul>
        ) : (
          <p className="text-[15px] font-bold text-muted">No ingredients listed.</p>
        )}

        <h2 className="font-display text-xl font-semibold mt-6 mb-2">Method</h2>
        {stepLines.length ? (
          <ol className="space-y-3">
            {stepLines.map((l, n) => (
              <li key={n} className="sticker p-3.5 flex gap-3">
                <span className="shrink-0 w-7 h-7 rounded-full bg-peach border-2 border-ink flex items-center justify-center font-display text-sm font-semibold">{n + 1}</span>
                <span className="text-[15px] font-semibold leading-relaxed">{l}</span>
              </li>
            ))}
          </ol>
        ) : (
          <div className="sticker p-4">
            {snack.steps
              ? <p className="text-[15px] font-semibold leading-relaxed whitespace-pre-line">{snack.steps}</p>
              : <p className="text-[15px] font-bold text-muted">No method saved for this recipe.</p>}
            {snack.url && (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button onClick={loadFull} disabled={loading} className="btn-plain" style={{ opacity: loading ? 0.6 : 1 }}>
                  {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />} Load the full recipe
                </button>
                <a href={snack.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-extrabold underline">
                  <Link2 size={12} /> open recipe page
                </a>
              </div>
            )}
            {err && <p className="text-xs font-bold mt-2">{err}</p>}
          </div>
        )}
      </div>

      <div className="fixed bottom-0 left-0 right-0 px-5 pb-4 pt-3 bg-blush border-t-2 border-line">
        <div className="mx-auto flex gap-3" style={{ maxWidth: 520 }}>
          <button onClick={onLater} className="btn-plain flex-1 min-h-[52px]">Cook Later</button>
          <button onClick={onFinish} className="btn-primary flex-1 min-h-[52px]">Finished</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- shopping view */

// Which weeks the list shows and whether bought items are hidden. A per-device
// preference, so it lives in localStorage rather than the shared data.
const KEY_LIST_VIEW = "snackplan:listview:v1";

function loadListView() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY_LIST_VIEW));
    if (v && Array.isArray(v.show) && v.show.length) return { show: v.show, hideBought: !!v.hideBought };
  } catch {}
  return { show: ["this", "next"], hideBought: false };
}

function saveListView(v) {
  try { localStorage.setItem(KEY_LIST_VIEW, JSON.stringify(v)); } catch {}
}

const hasListItems = (entry) => entry.snacks.length > 0 || (entry.week.manual || []).length > 0;

/* The shopping list is one combined list over the visible weeks. Ticks, "have it"
   and hand-added items are still stored per week (so they roll over with the week
   and survive a week being hidden): a combined row is ticked when every visible week
   that needs it has it ticked, and ticking it ticks it in each of those weeks. */
function combineLists(lists, view, pantrySet) {
  const visible = lists.filter((l) => view.show.includes(l.id));
  const { rows, grouped } = buildList(visible.flatMap((l) => l.snacks));
  const keysOf = new Map(visible.map((l) => [l.id, new Set(buildList(l.snacks).rows.map((r) => r.key))]));
  const weeksFor = (row) => visible.filter((l) => keysOf.get(l.id).has(row.key));
  const isChecked = (row) => weeksFor(row).every((l) => !!l.week.checked?.[row.key]);
  const isHave = (row) => pantrySet.has(normName(row.name)) || weeksFor(row).some((l) => !!l.week.have?.[row.key]);
  const manual = visible.flatMap((l) => (l.week.manual || []).map((m) => ({ ...m, list: l })));
  const recipeCount = new Set(visible.flatMap((l) => l.snacks.map((s) => s.id))).size;
  return { visible, rows, grouped, weeksFor, isChecked, isHave, manual, recipeCount };
}

// The still-to-buy items of the visible weeks, copied as plain text.
async function copyList(lists, view, pantry, flash) {
  const { visible, grouped, isChecked, isHave, manual } = combineLists(lists, view, new Set(pantry));
  const lines = [`Shopping list — ${visible.map((l) => prettyWeek(l.week.id)).join(" and ")}`, ""];
  for (const sec of SECTIONS) {
    const items = (grouped[sec] || []).filter((r) => !isHave(r) && !isChecked(r));
    const extra = manual.filter((m) => m.section === sec && !m.checked);
    if (!items.length && !extra.length) continue;
    lines.push(SECTION_LABEL[sec]);
    for (const r of items) lines.push(`- ${rowLabel(r)}`);
    for (const m of extra) lines.push(`- ${m.name}`);
    lines.push("");
  }
  const plainText = lines.length > 2 ? lines.join("\n").trim() : "Nothing left to buy.";
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

function ShoppingView({ lists, view, setView, pantry, setPantry, onGoToWeek }) {
  const pantrySet = useMemo(() => new Set(pantry), [pantry]);
  const { visible, rows, grouped, weeksFor, isChecked, isHave, manual, recipeCount } = combineLists(lists, view, pantrySet);
  const [showHave, setShowHave] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftSection, setDraftSection] = useState("produce");

  function update(v) {
    setView(v);
    saveListView(v);
  }
  function toggleWeek(id) {
    const on = view.show.includes(id);
    if (on && view.show.length === 1) return; // always show at least one week
    update({ ...view, show: on ? view.show.filter((x) => x !== id) : lists.map((l) => l.id).filter((x) => x === id || view.show.includes(x)) });
  }

  function toggleCheck(row) {
    const on = !isChecked(row);
    for (const l of weeksFor(row)) l.setWeek((w) => ({ ...w, checked: { ...w.checked, [row.key]: on } }));
  }

  function toggleHave(row) {
    const n = normName(row.name);
    const on = !isHave(row);
    for (const l of weeksFor(row)) l.setWeek((w) => ({ ...w, have: { ...w.have, [row.key]: on } }));
    setPantry((p) => (on ? [...new Set([...p, n])] : p.filter((x) => x !== n)));
  }

  // Hand-added items go to the earliest week shown.
  function addManual() {
    const text = draft.trim();
    if (!text || !visible.length) return;
    visible[0].setWeek((w) => ({
      ...w,
      manual: [...(w.manual || []), { id: newId(), name: text, section: draftSection, checked: false }],
    }));
    setDraft("");
  }
  function toggleManual(m) {
    m.list.setWeek((w) => ({ ...w, manual: (w.manual || []).map((x) => (x.id === m.id ? { ...x, checked: !x.checked } : x)) }));
  }
  function removeManual(m) {
    m.list.setWeek((w) => ({ ...w, manual: (w.manual || []).filter((x) => x.id !== m.id) }));
  }

  if (!lists.some(hasListItems)) {
    return (
      <Empty icon={ShoppingBasket} action={
        <button onClick={onGoToWeek} className="btn-primary">
          Plan a week
        </button>
      }>
        Plan dinners or choose snacks on the Week tab, for this week or next, and the list builds itself, with repeat ingredients added up.
      </Empty>
    );
  }

  const haveRows = rows.filter(isHave);
  const boughtCount = rows.filter((r) => !isHave(r) && isChecked(r)).length + manual.filter((m) => m.checked).length;
  const empty = !visible.some(hasListItems);

  return (
    <div className="px-5">
      <div className="flex gap-2 mb-2 overflow-x-auto py-1 -mx-5 px-5">
        {lists.map((l) => (
          <Pill key={l.id} active={view.show.includes(l.id)} onClick={() => toggleWeek(l.id)}>{l.label}</Pill>
        ))}
        <Pill active={view.hideBought} onClick={() => update({ ...view, hideBought: !view.hideBought })}>
          Hide bought
        </Pill>
      </div>
      <p className="mb-4 px-1 text-[13px] font-extrabold text-muted">
        {recipeCount} recipe{recipeCount === 1 ? "" : "s"}
        {view.hideBought && boughtCount > 0 && ` · ${boughtCount} bought item${boughtCount === 1 ? "" : "s"} hidden`}
      </p>

      {empty && (
        <div className="sticker bg-butter p-3.5 mb-4">
          <p className="text-[15px] font-bold">
            Nothing planned for {visible.length > 1 ? "these weeks" : visible[0].label.toLowerCase()} yet.
          </p>
          <button onClick={() => onGoToWeek(visible[0].id)} className="btn-primary mt-3">Plan it</button>
        </div>
      )}

      <div className="space-y-4">
        {SECTIONS.map((sec) => {
          const items = (grouped[sec] || []).filter((r) => !isHave(r) && !(view.hideBought && isChecked(r)));
          const extra = manual.filter((m) => m.section === sec && !(view.hideBought && m.checked));
          if (!items.length && !extra.length) return null;
          return (
            <div key={sec}>
              <h3 className={`inline-block ${SECTION_BG[sec]} border-2 border-ink rounded-full px-3 py-0.5 font-display text-sm font-semibold mb-2`}>
                {SECTION_LABEL[sec]}
              </h3>
              <div className="sticker overflow-hidden divide-y-2 divide-line">
                {items.map((r) => {
                  const done = isChecked(r);
                  return (
                    <div key={r.key} className="flex items-center min-h-[52px] pl-1 pr-1.5">
                      <CheckBox on={done} onClick={() => toggleCheck(r)} label={`Check off ${r.name}`} />
                      <div className="flex-1 min-w-0 py-2">
                        <span className={`text-[15px] font-extrabold block ${done ? "line-through text-muted" : ""}`}>
                          {rowLabel(r)}
                        </span>
                        {r.from.length > 1 && (
                          <span className="text-xs font-bold text-muted">for {r.from.length} recipes</span>
                        )}
                      </div>
                      <button onClick={() => toggleHave(r)} className="min-h-[44px] px-2.5 text-xs font-extrabold text-muted shrink-0">
                        have it
                      </button>
                    </div>
                  );
                })}
                {extra.map((m) => (
                  <div key={m.id} className="flex items-center min-h-[52px] pl-1 pr-1.5">
                    <CheckBox on={m.checked} onClick={() => toggleManual(m)} label={`Check off ${m.name}`} />
                    <span className={`flex-1 min-w-0 text-[15px] font-extrabold ${m.checked ? "line-through text-muted" : ""}`}>{m.name}</span>
                    <button onClick={() => removeManual(m)} aria-label={`Remove ${m.name}`} className="w-11 h-11 flex items-center justify-center shrink-0 text-muted">
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-5">
        <div className="flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addManual(); }}
            placeholder="Add something else"
            aria-label="Add something else"
            className="field flex-1 min-w-0"
          />
          <button onClick={addManual} aria-label="Add item"
                  className="btn-primary w-12 px-0 shrink-0">
            <Plus size={22} strokeWidth={2.6} />
          </button>
        </div>
        <div className="flex gap-1.5 mt-2 overflow-x-auto">
          {SECTIONS.map((s) => (
            <button key={s} onClick={() => setDraftSection(s)} aria-pressed={draftSection === s}
                    className={`min-h-[40px] px-3 rounded-full text-xs font-extrabold shrink-0 border-2 ${
                      draftSection === s ? `${SECTION_BG[s]} border-ink` : "border-transparent text-muted"
                    }`}>
              {SECTION_LABEL[s]}
            </button>
          ))}
        </div>
      </div>

      {haveRows.length > 0 && (
        <div className="mt-5">
          <button onClick={() => setShowHave((v) => !v)} aria-expanded={showHave}
                  className="min-h-[44px] flex items-center gap-1.5 text-[13px] font-extrabold text-muted px-1">
            {showHave ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            {haveRows.length} already at home
          </button>
          {showHave && (
            <div className="sticker mt-1 divide-y-2 divide-line overflow-hidden">
              {haveRows.map((r) => (
                <div key={r.key} className="flex items-center justify-between pl-4 pr-1.5 min-h-[52px]">
                  <span className="text-[15px] font-bold text-muted">{rowLabel(r)}</span>
                  <button onClick={() => toggleHave(r)} className="min-h-[44px] px-2.5 text-xs font-extrabold text-berry">
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
  // Chosen recipes, plus any cooked off-plan from the Library ("Cook Now").
  const ids = [...week.selected, ...week.prepped.filter((id) => !week.selected.includes(id))];
  const chosen = ids.map((id) => byId.get(id)).filter(Boolean);

  if (!chosen.length) {
    return (
      <Empty icon={ClipboardCheck} action={
        <button onClick={onGoToWeek} className="btn-primary">
          Plan this week
        </button>
      }>
        Once you've planned dinners or picked snacks for the week, rate them here. Ratings steer next week's suggestions.
      </Empty>
    );
  }

  return (
    <div className="px-5 space-y-3.5">
      {chosen.map((s) => {
        const prepped = week.prepped.includes(s.id);
        const verdict = week.logs?.[s.id];
        const dinner = hasTag(s, DINNER_TAG);
        const done = dinner ? "cooked" : "prepped";
        const dayIdx = DINNER_DAYS.find((d) => (week.dinners || {})[d] === s.id);
        return (
          <div key={s.id} className={`sticker p-3.5 ${prepped ? "" : "bg-peach"}`}>
            <div className="flex items-center gap-3">
              <CheckCircle on={prepped} onClick={() => onTogglePrepped(s.id)} size={36}
                           label={prepped ? `Unmark ${s.title} as ${done}` : `Mark ${s.title} as ${done}`} />
              <div className="min-w-0 flex-1">
                <h3 className="font-display text-base font-semibold leading-tight">{s.title}</h3>
                <p className="text-xs font-extrabold mt-1 inline-flex items-center gap-1.5">
                  <VegDot veg={s.vegetable} /> {s.vegetable}
                  {dayIdx != null && <><span>·</span>{dayInfo(week.id, dayIdx).short} dinner</>}
                </p>
              </div>
            </div>

            {prepped ? (
              <div className="flex gap-2 mt-3">
                {Object.entries(VERDICTS).map(([k, v]) => {
                  const on = verdict === k;
                  return (
                    <button key={k} onClick={() => onLog(s.id, k)} aria-pressed={on}
                            className={`btn flex-1 min-h-[48px] px-1 text-sm ${on ? `${v.bg} shadow-sticker-sm` : "bg-white"}`}>
                      {v.label}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-[13px] font-bold mt-3">Mark it {done} to rate it.</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ----------------------------------------------------------- library view */

function LibraryView({ library, onAdd, onRemove, onUpdate, week, isNext, selectedIds, onToggleInWeek, onToggleTag, onAssignDinner, onCookNow, busy, setBusy, flash }) {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("all"); // "all" | "dinner" | "snack"
  const [sheet, setSheet] = useState(null); // "url" | "manual"
  const [editing, setEditing] = useState(null); // snack being edited
  const [dayFor, setDayFor] = useState(null); // dinner waiting for a day
  const [url, setUrl] = useState("");
  const [importDinner, setImportDinner] = useState(false);
  const [importError, setImportError] = useState(null);
  const photoInput = useRef(null);
  const importing = busy === "import" || busy === "photo";

  const filtered = library.filter((s) => {
    if (kind === "dinner" && !hasTag(s, DINNER_TAG)) return false;
    if (kind === "snack" && hasTag(s, DINNER_TAG)) return false;
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
      // A dinner doesn't need the snack timing Claude guessed, so it starts without one.
      onAdd({ ...snack, tags: importDinner ? [DINNER_TAG] : [], tier: importDinner ? null : snack.tier });
      setUrl("");
      setImportDinner(false);
      setSheet(null);
    } catch (e) {
      setImportError("Couldn't read that page. Keep the link and fill in the details yourself.");
    } finally {
      setBusy(null);
    }
  }

  async function doPhotoImport(e) {
    const files = [...(e.target.files || [])].slice(0, MAX_PHOTOS);
    e.target.value = ""; // so picking the same photo again still fires
    if (!files.length) return;
    setImportError(null);
    setBusy("photo");
    try {
      const images = await Promise.all(files.map((f) => photoForClaude(f)));
      const snack = await importRecipePhoto(images);
      onAdd({ ...snack, tags: importDinner ? [DINNER_TAG] : [], tier: importDinner ? null : snack.tier });
      setImportDinner(false);
      setSheet(null);
    } catch (err) {
      console.error("photo import failed", err);
      setImportError("Couldn't read a recipe from that photo. Try a closer, well-lit shot of the whole recipe, or enter it by hand.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="px-5">
      <div className="flex gap-2 mb-3">
        <div className="flex-1 min-w-0 flex items-center gap-2 bg-white border-2 border-ink rounded-2xl px-3.5 min-h-[48px]">
          <Search size={18} className="text-muted shrink-0" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search recipes or vegetables"
                 aria-label="Search recipes or vegetables"
                 className="flex-1 min-w-0 py-2.5 text-[15px] font-bold outline-none bg-transparent" />
          {q && <button onClick={() => setQ("")} aria-label="Clear search" className="w-8 h-8 flex items-center justify-center text-muted"><X size={16} /></button>}
        </div>
        <button onClick={() => { setSheet("url"); setImportError(null); }} aria-label="Add a recipe"
                className="btn-primary w-12 px-0 min-h-[48px] shrink-0">
          <Plus size={22} strokeWidth={2.6} />
        </button>
      </div>

      <div className="flex gap-2 mb-4">
        {[["all", "All"], ["dinner", TAG_LABEL[DINNER_TAG]], ["snack", "Snacks"]].map(([id, label]) => (
          <Pill key={id} active={kind === id} onClick={() => setKind(id)}>{label}</Pill>
        ))}
      </div>

      {isNext && (
        <p className="mb-3 text-xs font-bold text-muted">
          Adding to next week. Switch back to this week on the Week tab.
        </p>
      )}

      {!filtered.length && (
        <Empty icon={BookMarked}>Nothing matches that. Try a vegetable name or switch the filter.</Empty>
      )}

      <div className="space-y-3">
        {filtered.map((s) => (
          <LibraryCard
            key={s.id} snack={s}
            inWeek={(selectedIds || []).includes(s.id)} isNext={isNext}
            onToggleInWeek={() => (
              hasTag(s, DINNER_TAG) && !(selectedIds || []).includes(s.id) ? setDayFor(s) : onToggleInWeek(s)
            )}
            onToggleTag={() => onToggleTag(s.id, DINNER_TAG)}
            onCookNow={() => onCookNow(s.id)}
            onEdit={() => setEditing(s)}
            onRemove={() => onRemove(s.id)}
          />
        ))}
      </div>

      <Sheet open={!!dayFor} onClose={() => setDayFor(null)} title={isNext ? "Which day next week?" : "Which day?"}>
        {dayFor && (
          <div className="space-y-2.5">
            {DINNER_DAYS.map((d) => {
              const info = dayInfo(week.id, d);
              const current = library.find((s) => s.id === (week.dinners || {})[d]);
              return (
                <button key={d}
                        onClick={() => { onAssignDinner(d, dayFor); flash(`Added ${dayFor.title} to ${info.long}`); setDayFor(null); }}
                        className="sticker w-full text-left px-4 py-3 flex items-center gap-3">
                  <span className="bg-peach border-2 border-ink rounded-full px-2.5 py-0.5 font-display text-sm font-semibold shrink-0">
                    {info.short} {info.date}
                  </span>
                  <span className="flex-1 min-w-0 truncate text-[15px] font-bold">
                    {current ? current.title : "Free"}
                  </span>
                  {current && <span className="text-xs font-extrabold text-muted shrink-0">swap</span>}
                </button>
              );
            })}
          </div>
        )}
      </Sheet>

      <Sheet open={!!editing} onClose={() => setEditing(null)} title="Edit snack">
        {editing && (
          <EditForm
            key={editing.id} snack={editing}
            onSave={(patch) => { onUpdate(editing.id, patch); setEditing(null); }}
          />
        )}
      </Sheet>

      <Sheet open={sheet === "url"} onClose={() => setSheet(null)} title="Add a recipe">
        <p className="text-sm font-semibold text-muted leading-relaxed mb-3">
          Paste a link or snap a photo, and the ingredients and quantities get pulled in so they feed the shopping list.
        </p>
        <input
          value={url} onChange={(e) => setUrl(e.target.value)}
          placeholder="https://"
          aria-label="Recipe link"
          className="field"
        />
        <div className="flex gap-2 mt-3">
          <Pill active={importDinner} onClick={() => setImportDinner((v) => !v)}>{TAG_LABEL[DINNER_TAG]}</Pill>
        </div>
        {importError && (
          <div className="mt-3 rounded-2xl border-2 border-ink bg-peach px-3.5 py-2.5 text-[13px] font-bold">
            {importError}
          </div>
        )}
        <div className="flex gap-2 mt-4">
          <button onClick={() => setSheet("manual")} className="btn-plain flex-1">
            Enter by hand
          </button>
          <button onClick={doImport} disabled={importing || !url.trim()}
                  className="btn-primary flex-1"
                  style={{ opacity: importing || !url.trim() ? 0.5 : 1 }}>
            {busy === "import" ? <><Loader2 size={16} className="animate-spin" /> Reading</> : "Pull it in"}
          </button>
        </div>
        <input ref={photoInput} type="file" accept="image/*" multiple onChange={doPhotoImport} className="hidden" />
        <button onClick={() => photoInput.current?.click()} disabled={importing}
                className="btn-plain w-full mt-2" style={{ opacity: importing ? 0.5 : 1 }}>
          {busy === "photo"
            ? <><Loader2 size={16} className="animate-spin" /> Reading the photo</>
            : <><Camera size={16} /> From a photo</>}
        </button>
        <p className="text-xs font-semibold text-muted mt-2 text-center">
          Up to {MAX_PHOTOS} photos, for recipes that run over more than one page.
        </p>
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

function LibraryCard({ snack: s, inWeek, isNext, onToggleInWeek, onToggleTag, onCookNow, onEdit, onRemove }) {
  const [open, setOpen] = useState(false);
  const last = lastVerdict(s);
  const dinner = hasTag(s, DINNER_TAG);

  return (
    <div className={`sticker px-4 py-3.5 ${open ? "bg-butter" : ""}`}>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="text-left w-full">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-display text-base font-semibold leading-tight">{s.title}</h3>
          {open ? <ChevronDown size={20} className="shrink-0" />
                : <ChevronRight size={20} className="shrink-0" />}
        </div>
        <div className="flex items-center gap-2 flex-wrap mt-1.5 text-xs font-extrabold">
          <span className="inline-flex items-center gap-1.5"><VegDot veg={s.vegetable} /> {s.vegetable}</span>
          {TIERS[s.tier] && (
            <>
              <span>·</span>
              <span>{TIERS[s.tier].label}</span>
            </>
          )}
          {!!cookMinutes(s) && (
            <>
              <span>·</span>
              <span className="inline-flex items-center gap-1"><Clock size={12} /> {cookMinutes(s)} min</span>
            </>
          )}
          {last && (
            <>
              <span>·</span>
              <span style={{ color: VERDICTS[last].tone }}>{VERDICTS[last].label.toLowerCase()}</span>
            </>
          )}
        </div>
        <p className="text-xs font-bold text-muted mt-1">
          {s.lastMadeWeek ? `Made week of ${prettyWeek(s.lastMadeWeek)}` : "Not made yet"}
          {(s.ratings || []).length > 1 && ` · ${s.ratings.length} times`}
        </p>
      </button>

      {open && (
        <div className="mt-3">
          {s.steps
            ? <p className="text-[13px] font-semibold leading-relaxed">{s.steps}</p>
            : <p className="text-[13px] font-bold text-muted">No description yet.</p>}
          {!!(s.ingredients || []).length && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {s.ingredients.map((i, n) => (
                <span key={n} className="chip bg-white">{ingredientLine(i)}</span>
              ))}
            </div>
          )}
          {s.url && (
            <a href={s.url} target="_blank" rel="noreferrer"
               className="inline-flex items-center gap-1 text-xs font-extrabold mt-2 underline">
              <Link2 size={12} /> recipe
            </a>
          )}
        </div>
      )}

      <div className="flex gap-2 mt-3 flex-wrap items-center">
        <button onClick={onToggleInWeek} aria-pressed={inWeek}
                className={`btn text-sm ${inWeek ? "bg-berry text-white shadow-sticker-sm" : "bg-white text-ink"}`}>
          {inWeek ? <><Check size={15} strokeWidth={3} /> {isNext ? "In next week" : "In this week"}</>
                  : <><Plus size={15} strokeWidth={2.6} /> {dinner ? "Add to a day" : isNext ? "Add to next week" : "Add to this week"}</>}
        </button>
        {open && (
          <button onClick={onToggleTag} aria-pressed={dinner}
                  className={`min-h-[44px] px-3 rounded-2xl border-2 text-[13px] font-extrabold ${
                    dinner ? "bg-mint text-mintink border-ink" : "bg-transparent text-muted border-dim"
                  }`}>
            {TAG_LABEL[DINNER_TAG]}
          </button>
        )}
        <button onClick={onCookNow} className="btn text-sm bg-white text-ink">
          <ChefHat size={15} strokeWidth={2.4} /> Cook Now
        </button>
        {open && (
          <button onClick={onEdit} className="btn-plain text-sm">
            <Pencil size={14} /> Edit
          </button>
        )}
        <button onClick={onRemove} aria-label={`Delete ${s.title}`}
                className="w-11 h-11 ml-auto flex items-center justify-center rounded-2xl border-2 border-ink bg-white shrink-0">
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
}

// A bare "example.com/recipe" would otherwise become a relative link.
function cleanUrl(raw) {
  const u = String(raw || "").trim();
  return u && !/^https?:\/\//i.test(u) ? `https://${u}` : u;
}

/* The snack timing tag. Snacks need one; dinners don't, so for a dinner tapping the
   selected tag again clears it. */
function TierPills({ tier, setTier, optional }) {
  return (
    <div>
      <div className="flex gap-2 flex-wrap">
        {TIER_ORDER.map((t) => (
          <Pill key={t} active={tier === t} onClick={() => setTier(tier === t && optional ? null : t)}>
            {TIERS[t].label}
          </Pill>
        ))}
      </div>
      {optional && (
        <p className="text-xs font-bold text-muted mt-1.5">Snack timing is optional for dinners. Tap the selected one to clear it.</p>
      )}
    </div>
  );
}

function EditForm({ snack, onSave }) {
  const dinner = hasTag(snack, DINNER_TAG);
  const [title, setTitle] = useState(snack.title || "");
  const [url, setUrl] = useState(snack.url || "");
  const [tier, setTier] = useState(snack.tier || null);
  const [steps, setSteps] = useState(snack.steps || "");
  const [method, setMethod] = useState(snack.method || "");
  const [minutes, setMinutes] = useState(snack.prepMinutes ? String(snack.prepMinutes) : "");
  const [lines, setLines] = useState((snack.ingredients || []).map(ingredientLine).join("\n"));

  function save() {
    if (!title.trim()) return;
    const n = Math.round(Number(minutes));
    onSave({
      title: title.trim(), url: cleanUrl(url), steps: steps.trim(), method: method.trim(),
      prepMinutes: n > 0 ? n : null,
      tier: dinner ? tier : tier || "assembly",
      ingredients: parseIngredientLines(lines, snack.ingredients || []),
    });
  }

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="text-xs font-extrabold text-muted">Name</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Recipe name"
               className="field mt-1" />
      </label>
      <label className="block">
        <span className="text-xs font-extrabold text-muted">Recipe link (optional)</span>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://"
               type="url" inputMode="url" className="field mt-1" />
      </label>
      <div>
        <span className="text-xs font-extrabold text-muted block mb-1">Snack timing</span>
        <TierPills tier={tier} setTier={setTier} optional={dinner} />
      </div>
      <label className="block">
        <span className="text-xs font-extrabold text-muted">Description</span>
        <textarea value={steps} onChange={(e) => setSteps(e.target.value)} rows={4}
                  placeholder="How to make it"
                  className="field mt-1 resize-none" />
      </label>
      <label className="block">
        <span className="text-xs font-extrabold text-muted">Full recipe (shown while cooking, one step per line)</span>
        <textarea value={method} onChange={(e) => setMethod(e.target.value)} rows={6}
                  placeholder="Every step, in full"
                  className="field mt-1 resize-none" />
      </label>
      <label className="block">
        <span className="text-xs font-extrabold text-muted">Time to prepare (minutes)</span>
        <input value={minutes} onChange={(e) => setMinutes(e.target.value)} placeholder="e.g. 10"
               type="number" inputMode="numeric" min="0"
               className="field mt-1" />
        {!!(snack.cookTimes || []).length && (
          <span className="text-xs font-bold text-muted block mt-1.5">
            Shown as {cookMinutes(snack)} min, the average of {snack.cookTimes.length} timed {snack.cookTimes.length === 1 ? "session" : "sessions"}. This is only the estimate until then.
          </span>
        )}
      </label>
      <label className="block">
        <span className="text-xs font-extrabold text-muted">Ingredients (one per line)</span>
        <textarea value={lines} onChange={(e) => setLines(e.target.value)} rows={6}
                  placeholder={"2 zucchini\n1 cup yogurt"}
                  className="field mt-1 resize-none" />
      </label>
      <button onClick={save} disabled={!title.trim()}
              className="btn-primary w-full"
              style={{ opacity: title.trim() ? 1 : 0.5 }}>
        Save changes
      </button>
    </div>
  );
}

function ManualForm({ initialUrl, onSave }) {
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState(initialUrl || "");
  const [veg, setVeg] = useState("");
  const [tier, setTier] = useState("assembly");
  const [steps, setSteps] = useState("");
  const [lines, setLines] = useState("");
  const [dinner, setDinner] = useState(false);

  // A dinner starts with no snack timing; turning the tag off gives a snack its default back.
  function toggleDinner() {
    const next = !dinner;
    setDinner(next);
    setTier(next ? null : tier || "assembly");
  }

  function save() {
    if (!title.trim()) return;
    const ingredients = parseIngredientLines(lines);
    onSave({
      id: newId(), title: title.trim(), vegetable: veg.trim().toLowerCase() || "mixed",
      tier: dinner ? tier : tier || "assembly", prepMinutes: null, ingredients,
      steps: steps.trim(), url: cleanUrl(url),
      tags: dinner ? [DINNER_TAG] : [],
      source: "manual", ratings: [], lastMadeWeek: null,
    });
  }

  return (
    <div className="space-y-3">
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Recipe name"
             aria-label="Recipe name" className="field" />
      <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Recipe link (optional)"
             aria-label="Recipe link (optional)" type="url" inputMode="url" className="field" />
      <input value={veg} onChange={(e) => setVeg(e.target.value)} placeholder="Main vegetable"
             aria-label="Main vegetable" className="field" />
      <div className="flex gap-2">
        <Pill active={dinner} onClick={toggleDinner}>{TAG_LABEL[DINNER_TAG]}</Pill>
      </div>
      <TierPills tier={tier} setTier={setTier} optional={dinner} />
      <textarea value={steps} onChange={(e) => setSteps(e.target.value)} rows={3}
                placeholder="Description: how to make it"
                aria-label="Description: how to make it"
                className="field resize-none" />
      <textarea value={lines} onChange={(e) => setLines(e.target.value)} rows={5}
                placeholder={"One ingredient per line\n2 zucchini\n1 cup yogurt"}
                aria-label="Ingredients, one per line"
                className="field resize-none" />
      <button onClick={save} disabled={!title.trim()}
              className="btn-primary w-full"
              style={{ opacity: title.trim() ? 1 : 0.5 }}>
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
    <div className="px-5">
      <section className="mb-7">
        <h2 className="font-display text-xl font-semibold mb-1">Exposures by vegetable</h2>
        <p className="text-[13px] font-semibold text-muted leading-relaxed mb-3">
          Acceptance often takes ten or more calm tries. A short bar isn't a no yet.
        </p>
        <div className="sticker divide-y-2 divide-line overflow-hidden">
          {vegStats.map((v) => (
            <div key={v.veg} className="px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[15px] font-extrabold inline-flex items-center gap-2 min-w-0">
                  <VegDot veg={v.veg} /> <span className="truncate">{v.veg}</span>
                </span>
                <span className="flex items-center gap-2 shrink-0">
                  {v.warming && <span className="chip bg-mint text-mintink">warming up</span>}
                  <ExposureMeter count={v.exposures} color={vegColor(v.veg)} />
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="font-display text-xl font-semibold mb-3">Past weeks</h2>
        <div className="space-y-3.5">
          {past.map((w) => (
            <div key={w.id} className="sticker px-4 py-3.5">
              <h3 className="inline-block bg-butter border-2 border-ink rounded-full px-3 py-0.5 font-display text-sm font-semibold mb-2.5">{prettyWeek(w.id)}</h3>
              <ul className="space-y-1.5">
                {(w.entries || []).map((e, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 text-[15px]">
                    <span className="font-bold truncate">{e.title}</span>
                    {e.verdict && (
                      <span className={`chip shrink-0 text-ink ${VERDICTS[e.verdict].bg}`}>
                        {VERDICTS[e.verdict].label}
                      </span>
                    )}
                  </li>
                ))}
                {!(w.entries || []).length && <li className="text-sm font-bold text-muted">Nothing logged</li>}
              </ul>
            </div>
          ))}
          {!past.length && <p className="text-sm font-bold text-muted">This is your first week.</p>}
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------- auth */

function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setError("That email and password didn't work.");
    setBusy(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-5 bg-blush">
      <form onSubmit={submit} className="sticker w-full p-6" style={{ maxWidth: 360 }}>
        <div className="flex items-center gap-3 mb-5">
          <span className="w-11 h-11 rounded-2xl bg-butter border-2 border-ink flex items-center justify-center">
            <Carrot size={24} />
          </span>
          <h1 className="font-display text-2xl font-semibold">Snack Planner</h1>
        </div>
        {!supabaseConfigured && (
          <p className="mb-3 text-[13px] font-bold text-muted">
            Supabase isn't configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.
          </p>
        )}
        <input
          type="email" autoComplete="email" required value={email}
          onChange={(e) => setEmail(e.target.value)} placeholder="Email" aria-label="Email"
          className="field mb-3"
        />
        <input
          type="password" autoComplete="current-password" required value={password}
          onChange={(e) => setPassword(e.target.value)} placeholder="Password" aria-label="Password"
          className="field"
        />
        {error && (
          <div className="mt-3 rounded-2xl border-2 border-ink bg-peach px-3.5 py-2.5 text-[13px] font-bold">
            {error}
          </div>
        )}
        <button
          type="submit" disabled={busy || !supabaseConfigured}
          className="btn-primary w-full mt-4"
          style={{ opacity: busy || !supabaseConfigured ? 0.6 : 1 }}
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : "Sign in"}
        </button>
      </form>
    </div>
  );
}

export default function SnackPlanner() {
  const [session, setSession] = useState(undefined);

  useEffect(() => {
    if (!supabase) { setSession(null); return; }
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (session === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-blush">
        <Loader2 className="animate-spin text-muted" size={22} />
      </div>
    );
  }
  if (!session) return <LoginForm />;
  return <SnackPlannerApp key={session.user.id} onSignOut={() => supabase.auth.signOut()} />;
}
