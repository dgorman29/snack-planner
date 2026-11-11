# Architecture

```
Browser (GitHub Pages)
  ├─ supabase-js ──HTTPS──> Supabase REST ──> Postgres: households, household_members,
  │                                              household_invites, household_data
  └─ fetch ───────HTTPS──> Edge Function snack-ai ──> Anthropic API
```

## Pieces
| Piece | Where | Role |
|---|---|---|
| Frontend | `snack-planner/` (Vite + React + Tailwind) | The whole app is `src/SnackPlanner.jsx` |
| Database | Supabase project `oobnfidfqihesilvhoxv` | Households (migration `0003_households.sql`); app data in `household_data(household_id, key, value jsonb, updated_at)` |
| AI proxy | `supabase/functions/snack-ai/index.ts` | Checks the caller is a signed-in user (`/auth/v1/user`), holds `ANTHROPIC_API_KEY`, forwards prompts plus optional `images` (up to 4 base64 JPEG/PNG/WebP/GIF, sent before the prompt text) |
| Hosting | GitHub Pages | Built and deployed by `.github/workflows/deploy.yml` on push to `main` |

## Households
| Table | Holds |
|---|---|
| `households` | `id`, `name`, `share_library` (off by default), `created_by` |
| `household_members` | One row per login (`user_id` is the primary key, so one household each): `household_id`, `email` (copied at join time for the member list), `show_shared` (this person's "Show other households' libraries" switch) |
| `household_invites` | `code` (8 uppercase hex characters), `household_id`, `expires_at` (7 days). Reusable until it expires |
| `household_data` | The app's JSON blobs, primary key `(household_id, key)` |

Row-level security: members can read their household and its member list, rename it and flip `share_library` (plain `update` on `households`), and read, insert and update its `household_data`. `household_invites` has no policies. Everything else goes through `security definer` functions, callable only by the `authenticated` role:
- `my_household_id()`: the caller's household; the policies use it (it avoids policies on `household_members` querying themselves).
- `create_household(household_name)`, `join_household(invite_code)`: fail with a readable message if the caller already has a household or the code is wrong/expired. The frontend shows these messages as they are.
- `create_household_invite()`: new code for the caller's household; also clears expired codes.
- `leave_household()`: removes the caller; the last member out deletes the household (its data cascades).
- `set_show_shared(show)`.
- `shared_libraries()`: `(household_id, household_name, recipes)` for every other household with `share_library` on. Each recipe has `ratings` and `lastMadeWeek` removed. This is the only way to read another household's data.

The frontend (`SnackPlanner` at the bottom of `SnackPlanner.jsx`) loads the session, then the household (`loadHousehold`), then mounts `SnackPlannerApp` keyed by household id. No household shows `HouseholdSetup`. The Household panel calls `onHouseholdChange` after each change to reload it.

## Storage model
Five keys, each a JSON blob in `household_data` for the household (originally `window.storage` in the Claude Artifact version). `loadKey`/`saveKey` take the household id:
- `snackplan:core:v1`: archived weeks, exposure counts and `sections`. Libraries saved before migration 0003 were also in here; the migration moved them out, and the loader still falls back to `core.library` if there is no library key.
- `snackplan:library:v1`: the recipe array, kept apart from history so it can be shared. Library snacks may carry `tags: ["weekday-dinner"]`; snacks saved before tags existed simply have no `tags` field. They may also carry `method` (the full recipe text, one step per line; `steps` stays the short card summary) and `cookTimes` (seconds, one per finished cooking session; the displayed time is their average, see `cookMinutes`). Older snacks have neither field. Copies from another household carry `copiedFrom: { householdId, householdName, id }` (used to show "In our library") and `source: "shared"`. In core, `sections` maps a lowercased ingredient name to the shopping-list section Claude chose for it (absent in older saves). A hand-typed ingredient carries `guessed: true` until it has been sorted.
- `snackplan:week:v1`: the current week (suggestions, picks, prepped, ratings, list state, and `dinners`: a map of day index, Monday = 0 to Sunday = 6, to a library recipe id). A planned dinner is always also in `selected`, which is what the shopping list and Log read. Weeks saved before dinners existed have no `dinners` field and load as empty.
- `snackplan:nextweek:v1`: next week's plan, same shape as `snackplan:week:v1` with next Monday as its `id`. On load, if the stored current week is out of date it is archived as before, and a stored next week whose `id` is now this Monday becomes the current week. A next week with any other `id` is replaced by an empty one. Next week's `prepped` and `logs` stay empty because cooking and rating only apply to the current week.
- `snackplan:pantry:v1`: ingredients always on hand

Two more keys live in the browser's `localStorage`, not Supabase, both per device on purpose:
- `snackplan:cooking:v1`: the in-progress cooking session `{ id, startedAt }`, removed on Finished or Cook Later.
- `snackplan:listview:v1`: the shopping list filters `{ show: ["this", "next"], hideBought }`.

Users sign in with Supabase Auth email/password; sign-ups are disabled in the dashboard and accounts are created by hand. The old `kv_store` table is kept as a backup from before households, but 0003 dropped its policies so the app can't reach it; drop it in a later migration once nothing needs it.

Migration 0003 put every existing account into one household named "Our household" with the old `kv_store` data. Accounts that should have their own household leave it from the Household panel and create a new one.

## Styling
- Tailwind with a custom palette and fonts in `snack-planner/tailwind.config.js` (`blush`, `ink`, `peach`, `butter`, `mint`, `berry`, etc.; `font-display` is Fredoka, the default sans is Nunito). Change a color there and the whole app follows.
- `src/index.css` defines the shared component classes: `.sticker` (outlined card with offset shadow), `.btn` / `.btn-primary` / `.btn-plain`, `.field` (inputs) and `.chip`.
- Fonts load from Google Fonts via a `<link>` in `index.html`, so the app needs a network connection for its typefaces (it already needs one for data).
- Vegetable dot colors (`VEG_PALETTE` in `SnackPlanner.jsx`) are the only colors still set in JS.

## PWA install
- `snack-planner/public/manifest.webmanifest` plus `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`, linked from `index.html` via `%BASE_URL%`. No service worker.
- The manifest `id`, `start_url` and `scope` are all `/snack-planner/`. Chrome identifies installed apps by these, and other apps on the same `github.io` origin would otherwise be mistaken for this one. Keep them in sync with the Vite `base`.
- `theme_color` and `background_color` are the blush page color `#FFF0EA`; keep them in sync with `blush` in `tailwind.config.js`.
- The icons are placeholders generated by a one-off script; replace the PNGs to change the look (keep the artwork inside the central 80% so Android can mask it).

## Environment variables
Set in `snack-planner/.env.local` for local dev, and as GitHub Actions secrets for the deployed build:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_SNACK_AI_URL`

Function secrets (Supabase, not in the repo): `ANTHROPIC_API_KEY`, optional `ALLOWED_ORIGIN`.

## Deploying
- **Frontend:** push to `main`. The workflow builds `snack-planner/` and publishes `dist`. Vite `base` is `/snack-planner/`.
- **Function:** push a change under `supabase/functions/` to `main` and `.github/workflows/deploy-functions.yml` deploys `snack-ai` (also runnable by hand from the Actions tab). It needs a `SUPABASE_ACCESS_TOKEN` repository secret (Supabase dashboard > Account > Access Tokens) and reads the project ref from the `VITE_SUPABASE_URL` secret. By hand: `supabase functions deploy snack-ai --no-verify-jwt` from the repo root.
- **Schema:** add a new file under `supabase/migrations/` and run `supabase db push` from the repo root. Apply a migration before pushing the frontend that needs it: the households frontend can't load anything until 0003 is applied.

## Gotchas
- `supabase db push` needs a direct Postgres connection (ports 5432/6543). Some networks block this; the Supabase SQL Editor works over HTTPS as a fallback. Migration `0001` was applied that way, so it may need `supabase migration repair --status applied 0001` before a future `db push`.
- Supabase CLI commands run from the repo root; npm commands run from `snack-planner/`.
- The anon key is public by design (it ships in the built JS). Never put the service_role key or the Anthropic key in the frontend.
