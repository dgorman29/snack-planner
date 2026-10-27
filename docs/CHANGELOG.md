# Changelog

Newest first. Add an entry for every user-visible or infrastructure change.

## 2026-10-27
- Adding a recipe by hand now has a recipe link field and the description ("how to make it") field; Edit also lets you change the link. Dinners no longer need a snack timing tag (optional for dinners, still required for snacks). Popups now open centered instead of sliding up from the bottom.
- Dinners view has a "Clear week" button (with a confirm step) that empties all planned dinners.
- Snacks view has a "Chosen (N)" filter that lists every snack chosen for the current week.
- Added weekday dinner planning. The Week tab now has a Dinners / Snacks toggle: Dinners shows a "Tonight" card plus a tile per weekday (Mon-Fri) with swap, clear, "Mark cooked" and "Fill empty days from my library". Recipes tagged Weekday dinner are dinners and are kept out of snack suggestions. Library has All / Weekday dinner / Snacks filters, "Add to a day" for dinners, and a dinner option when adding by URL. The shopping list and Log now cover dinners too. Week data gains a `dinners` map (no migration needed).
- Reskinned the app as "Peach Jam": blush background, cocoa outlines with flat offset shadows on cards ("stickers"), Fredoka headings and Nunito body text, a floating dark nav bar, and a berry accent. Colors live in `tailwind.config.js`; shared styles in `src/index.css`. No behavior or data changes. Week tab title is now "Our week".
- Library edit form can now change the ingredients list. Fixed hand-entered ingredients starting with "g" (e.g. "2 garlic") being misread as grams.
- Library snacks now expand to show description, ingredients and recipe link, and can be edited (name, description, prep time).

## 2026-10-26
- Added a "Weekday dinner" tag (toggle in the Library, filter pill on Library and Week tabs, option when adding by hand) and an "Add to this week" button on library snacks.
- Added a web app manifest and placeholder cookie icons so Chrome can install Snack Planner as its own app (own `id`/`scope` of `/snack-planner/`, so it no longer clashes with other apps on the same github.io origin).
- Added login: Supabase Auth email/password, invite-only. `kv_store` is now readable/writable only by signed-in users (migration `0002_auth.sql`), and `snack-ai` rejects requests without a valid user session.
- Idea generation errors now show the underlying reason in the banner and console.
- `snack-ai` function `max_tokens` raised from 1000 to 2500 so larger idea batches aren't truncated.
- Deploy to GitHub Pages via GitHub Actions; Vite `base` set to `/snack-planner/`.
- Added `docs/` and `CLAUDE.md`.

## 2026-09-16
- Initial port of the Claude Artifact (`snack-planner.jsx`) to a standalone Vite/React app.
- Storage moved from `window.storage` to Supabase (`kv_store`).
- Direct browser calls to the Anthropic API replaced by the `snack-ai` Supabase Edge Function.
