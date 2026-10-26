# Snack Planner

Vite + React frontend in `snack-planner/`, Supabase backend in `supabase/`. See `README.md` for setup and `docs/` for details.

## Documentation upkeep
When you change behavior, keep the docs in the same commit:
- `docs/FEATURES.md`: user-visible features and rules
- `docs/ARCHITECTURE.md`: structure, storage, env vars, deploy steps
- `docs/CHANGELOG.md`: one dated line per change, newest first
- `README.md`: only if setup steps change

## Conventions
- Run `supabase` commands from the repo root and `npm` commands from `snack-planner/`.
- Never commit `.env.local` or any API key. The Anthropic key lives only in Supabase function secrets.
- Pushing to `main` deploys the site.
