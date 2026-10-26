# Changelog

Newest first. Add an entry for every user-visible or infrastructure change.

## 2026-10-26
- Added a web app manifest and placeholder cookie icons so Chrome can install Snack Planner as its own app (own `id`/`scope` of `/snack-planner/`, so it no longer clashes with other apps on the same github.io origin).
- Idea generation errors now show the underlying reason in the banner and console.
- `snack-ai` function `max_tokens` raised from 1000 to 2500 so larger idea batches aren't truncated.
- Deploy to GitHub Pages via GitHub Actions; Vite `base` set to `/snack-planner/`.
- Added `docs/` and `CLAUDE.md`.

## 2026-09-16
- Initial port of the Claude Artifact (`snack-planner.jsx`) to a standalone Vite/React app.
- Storage moved from `window.storage` to Supabase (`kv_store`).
- Direct browser calls to the Anthropic API replaced by the `snack-ai` Supabase Edge Function.
