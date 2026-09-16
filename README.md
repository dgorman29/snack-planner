# Snack Planner

A vegetable-snack rotation planner (suggestions, shopping list, prep log,
history) for a toddler, running as a static React app with Supabase for
storage and AI-generated ideas.

## Project layout

```
snack-planner-repo/              Repo root — Supabase CLI commands run from here
  snack-planner/                 Frontend app — npm commands run from here
    src/SnackPlanner.jsx           The whole app (converted from the Claude Artifact version)
    src/lib/supabaseClient.js      Supabase client, reads VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
  supabase/                      Linked Supabase project
    config.toml
    migrations/0001_init.sql       The one table the app needs (kv_store)
    functions/snack-ai/index.ts    Edge Function that proxies AI calls, holding the Anthropic key
```

The `supabase/` folder and the frontend are siblings under this repo root —
the Supabase CLI expects to run at the repo root (where `supabase/` lives),
while `npm`/Vite commands run one level down, inside `snack-planner/`.

Storage model: the app keeps three JSON blobs (recipe library + history,
this week's plan, pantry list) — same shape as the original `window.storage`
version. Those now live as three rows in one `kv_store(key, value jsonb)`
table instead of three separate normalized tables, to keep the port
mechanical. If this grows into a multi-user app, that's the first thing
to properly normalize.

## One-time setup

All `supabase` commands below run from `snack-planner-repo\` (the repo
root). All `npm` commands run from `snack-planner-repo\snack-planner\`.

1. **Create a Supabase project** at [supabase.com](https://supabase.com) (free tier is plenty).

2. **Install the Supabase CLI** and log in:
   ```
   npm install -g supabase
   supabase login
   ```

3. **Link this repo to your project** (from the repo root; project ref is in
   the Supabase dashboard URL):
   ```
   cd snack-planner-repo
   supabase init
   supabase link --project-ref YOUR-PROJECT-REF
   ```

4. **Apply the database migration:**
   ```
   supabase db push
   ```

5. **Set your Anthropic API key as a function secret** (get one at
   [console.anthropic.com](https://console.anthropic.com) if you don't have one — this is a
   separate paid key from your claude.ai subscription):
   ```
   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
   ```

6. **Deploy the Edge Function:**
   ```
   supabase functions deploy snack-ai --no-verify-jwt
   ```
   `--no-verify-jwt` is needed because this app has no login, so requests
   arrive with no Supabase auth token.

7. **Get your API URL and anon key** from Project Settings -> API in the
   Supabase dashboard. Inside `snack-planner/`, copy `.env.example` to
   `.env.local`, filling in:
   - `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (Project Settings -> API)
   - `VITE_SNACK_AI_URL` -> `https://YOUR-PROJECT-REF.supabase.co/functions/v1/snack-ai`

8. **Install frontend dependencies:**
   ```
   cd snack-planner
   npm install
   ```

## Local development

```
cd snack-planner
npm run dev
```

## Deploying the frontend (Vercel)

Supabase only hosts the database and the Edge Function — the static
frontend needs a separate host. Vercel is the simplest pairing:

1. Push this repo to GitHub.
2. In Vercel, **Add New -> Project**, import the repo, and set the **Root
   Directory** to `snack-planner` (Vercel builds from there, not the repo root).
3. Add the same three env vars from `.env.local` under **Settings -> Environment
   Variables** (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SNACK_AI_URL`).
4. Deploy. Pushing to `main` redeploys automatically from then on.

Once you have the real Vercel URL, tighten the Edge Function's CORS by
setting `ALLOWED_ORIGIN`:
```
supabase secrets set ALLOWED_ORIGIN=https://your-app.vercel.app
```

## Notes

- **No login.** Anyone with the Vercel URL can read and write the data —
  same tradeoff as the meal-journal app. Don't share the link publicly.
- **Anthropic cost.** Each "Suggest snacks" / "More ideas" click and each
  recipe-URL import is one Claude API call, billed on your Anthropic
  console account, separate from any claude.ai subscription.
- Supabase free tier (500 MB DB, 500K Edge Function invocations/month) is
  far more than this app will ever use.
