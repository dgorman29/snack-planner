-- Single key/value table that mirrors the three window.storage keys the
-- original Artifact used (snackplan:core:v1, snackplan:week:v1, snackplan:pantry:v1).
create table if not exists kv_store (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- Open access, no login: anyone with the anon key (which ships in the
-- frontend bundle anyway) can read and write. Fine for a private family
-- app whose URL isn't shared; do not use this policy for anything public.
alter table kv_store enable row level security;

create policy "anon read" on kv_store
  for select to anon using (true);

create policy "anon write" on kv_store
  for insert to anon with check (true);

create policy "anon update" on kv_store
  for update to anon using (true) with check (true);
