-- Households: each login belongs to at most one household, and all app data
-- is scoped to a household. Replaces the single shared kv_store.
--
-- Members of a household read and write only their household's rows
-- (household_data). Other households' libraries are never readable directly;
-- the shared_libraries() function returns the recipes of households that
-- turned sharing on, without their ratings.
--
-- Joining, creating and leaving go through security definer functions so a
-- user can only add themselves to a household with a valid invite code.

create table households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 60),
  share_library boolean not null default false,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);

create table household_members (
  user_id uuid primary key references auth.users on delete cascade, -- one household per login
  household_id uuid not null references households on delete cascade,
  email text,
  show_shared boolean not null default false, -- this user sees other households' libraries
  joined_at timestamptz not null default now()
);
create index household_members_household on household_members (household_id);

create table household_invites (
  code text primary key,
  household_id uuid not null references households on delete cascade,
  created_by uuid references auth.users on delete set null,
  expires_at timestamptz not null
);

create table household_data (
  household_id uuid not null references households on delete cascade,
  key text not null,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (household_id, key)
);

/* ------------------------------------------------------------- helpers */

-- The caller's household, or null. Security definer so policies on
-- household_members can use it without recursing into themselves.
create function my_household_id() returns uuid
  language sql stable security definer set search_path = public as $$
  select household_id from household_members where user_id = auth.uid()
$$;

/* ---------------------------------------------------------------- RLS */

alter table households enable row level security;
alter table household_members enable row level security;
alter table household_invites enable row level security; -- no policies: functions only
alter table household_data enable row level security;

create policy "members read" on households
  for select to authenticated using (id = my_household_id());
create policy "members update" on households
  for update to authenticated using (id = my_household_id()) with check (id = my_household_id());

create policy "members read" on household_members
  for select to authenticated using (household_id = my_household_id());

create policy "members read" on household_data
  for select to authenticated using (household_id = my_household_id());
create policy "members insert" on household_data
  for insert to authenticated with check (household_id = my_household_id());
create policy "members update" on household_data
  for update to authenticated using (household_id = my_household_id()) with check (household_id = my_household_id());

/* ----------------------------------------------------------- functions */

create function create_household(household_name text) returns uuid
  language plpgsql security definer set search_path = public as $$
declare hid uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if my_household_id() is not null then raise exception 'Already in a household'; end if;
  insert into households (name, created_by) values (trim(household_name), auth.uid()) returning id into hid;
  insert into household_members (user_id, household_id, email) values (auth.uid(), hid, auth.jwt() ->> 'email');
  return hid;
end $$;

create function join_household(invite_code text) returns uuid
  language plpgsql security definer set search_path = public as $$
declare hid uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if my_household_id() is not null then raise exception 'Already in a household'; end if;
  select household_id into hid from household_invites
    where code = upper(trim(invite_code)) and expires_at > now();
  if hid is null then raise exception 'That code is wrong or has expired'; end if;
  insert into household_members (user_id, household_id, email) values (auth.uid(), hid, auth.jwt() ->> 'email');
  return hid;
end $$;

-- A new 8-character code for the caller's household, good for 7 days.
create function create_household_invite() returns text
  language plpgsql security definer set search_path = public as $$
declare hid uuid := my_household_id(); c text;
begin
  if hid is null then raise exception 'Not in a household'; end if;
  delete from household_invites where expires_at <= now();
  c := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into household_invites (code, household_id, created_by, expires_at)
    values (c, hid, auth.uid(), now() + interval '7 days');
  return c;
end $$;

-- Leaves the household. The last member out deletes it and all its data.
create function leave_household() returns void
  language plpgsql security definer set search_path = public as $$
declare hid uuid := my_household_id();
begin
  if hid is null then return; end if;
  delete from household_members where user_id = auth.uid();
  if not exists (select 1 from household_members where household_id = hid) then
    delete from households where id = hid;
  end if;
end $$;

create function set_show_shared(show boolean) returns void
  language sql security definer set search_path = public as $$
  update household_members set show_shared = show where user_id = auth.uid()
$$;

-- Libraries of the other households that share theirs. Ratings and the last
-- week made stay private; cook times are included so their times show.
create function shared_libraries()
  returns table (household_id uuid, household_name text, recipes jsonb)
  language sql stable security definer set search_path = public as $$
  select h.id, h.name,
         coalesce((select jsonb_agg(r - 'ratings' - 'lastMadeWeek')
                   from jsonb_array_elements(case when jsonb_typeof(d.value) = 'array' then d.value else '[]'::jsonb end) r),
                  '[]'::jsonb)
  from households h
  join household_data d on d.household_id = h.id and d.key = 'snackplan:library:v1'
  where h.share_library
    and auth.uid() is not null
    and h.id is distinct from my_household_id()
  order by h.name
$$;

revoke execute on function my_household_id(), create_household(text), join_household(text),
  create_household_invite(), leave_household(), set_show_shared(boolean), shared_libraries()
  from public, anon;
grant execute on function my_household_id(), create_household(text), join_household(text),
  create_household_invite(), leave_household(), set_show_shared(boolean), shared_libraries()
  to authenticated;

/* ------------------------------------------------------ move old data */
-- Everyone who could sign in shared kv_store, so they all become members of
-- one household that inherits it. The library moves out of the core blob into
-- its own key so it can be shared without history.

do $$
declare hid uuid;
begin
  if not exists (select 1 from kv_store) and not exists (select 1 from auth.users) then return; end if;
  insert into households (name) values ('Our household') returning id into hid;
  insert into household_members (user_id, household_id, email)
    select id, hid, email from auth.users;
  insert into household_data (household_id, key, value, updated_at)
    select hid, key, case when key = 'snackplan:core:v1' then value - 'library' else value end, updated_at
    from kv_store;
  insert into household_data (household_id, key, value, updated_at)
    select hid, 'snackplan:library:v1', value -> 'library', updated_at
    from kv_store where key = 'snackplan:core:v1' and jsonb_typeof(value -> 'library') = 'array';
end $$;

-- kv_store stays as a backup for one release but is no longer reachable from the app.
drop policy if exists "authenticated read" on kv_store;
drop policy if exists "authenticated write" on kv_store;
drop policy if exists "authenticated update" on kv_store;
