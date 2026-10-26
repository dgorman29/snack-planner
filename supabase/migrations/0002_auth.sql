-- Replace the open anon policies from 0001 with signed-in-only access.
-- Everyone who can sign in shares the same data (one household).
drop policy if exists "anon read" on kv_store;
drop policy if exists "anon write" on kv_store;
drop policy if exists "anon update" on kv_store;

create policy "authenticated read" on kv_store
  for select to authenticated using (true);

create policy "authenticated write" on kv_store
  for insert to authenticated with check (true);

create policy "authenticated update" on kv_store
  for update to authenticated using (true) with check (true);
