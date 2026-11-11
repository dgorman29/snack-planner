-- Open sign-up with an approval gate, a daily cap on AI recipe imports, and
-- removing household members.
--
-- Anyone may create an account once sign-ups are on, but an account can't do
-- anything until it is either approved (profiles.approved, ticked by hand in
-- the Supabase Table Editor) or joins a household with an invite code made by
-- a member. Only approved accounts can start a new household. AI calls need
-- household membership (claim_ai_call), so a stray sign-up can't spend
-- Anthropic credit.

create table profiles (
  user_id uuid primary key references auth.users on delete cascade,
  email text,
  approved boolean not null default false,
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;
create policy "own profile" on profiles
  for select to authenticated using (user_id = auth.uid());
-- No insert/update policies: rows come from the trigger, approval from the dashboard.

-- Everyone who already has an account is approved.
insert into profiles (user_id, email, approved)
  select id, email, true from auth.users
  on conflict (user_id) do nothing;

create function handle_new_user() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id, email) values (new.id, new.email)
    on conflict (user_id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

/* -------------------------------------------- creating needs approval */

create or replace function create_household(household_name text) returns uuid
  language plpgsql security definer set search_path = public as $$
declare hid uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if my_household_id() is not null then raise exception 'Already in a household'; end if;
  if not coalesce((select approved from profiles where user_id = auth.uid()), false) then
    raise exception 'Your account needs to be approved before you can start a household. You can still join one with an invite code.';
  end if;
  insert into households (name, created_by) values (trim(household_name), auth.uid()) returning id into hid;
  insert into household_members (user_id, household_id, email) values (auth.uid(), hid, auth.jwt() ->> 'email');
  return hid;
end $$;

/* ------------------------------------------------- removing a member */

-- Any member can remove another member of the same household (leave_household
-- is for removing yourself). Their data stays with the household.
create function remove_household_member(member_id uuid) returns void
  language plpgsql security definer set search_path = public as $$
declare hid uuid := my_household_id();
begin
  if hid is null then raise exception 'Not in a household'; end if;
  if member_id = auth.uid() then raise exception 'Use "Leave household" to remove yourself'; end if;
  delete from household_members where user_id = member_id and household_id = hid;
  if not found then raise exception 'That person isn''t in your household'; end if;
end $$;

/* ------------------------------------------------------ AI usage cap */

create table ai_calls (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users on delete cascade,
  is_import boolean not null,
  created_at timestamptz not null default now()
);
create index ai_calls_user_time on ai_calls (user_id, created_at);
alter table ai_calls enable row level security; -- no policies: claim_ai_call only

-- Called by the snack-ai Edge Function, with the caller's own token, before
-- every Anthropic request. Imports are calls that read a web page or photos
-- (link import, photo import, "Load the full recipe"); at most 10 in any 24
-- hours per person. Other calls (ideas, sorting ingredients) are not capped
-- but still need a household. Returns { ok, error?, remaining? }.
create function claim_ai_call(is_import boolean) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare used int;
  daily_imports constant int := 10;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'Not signed in'); end if;
  if my_household_id() is null then
    return jsonb_build_object('ok', false, 'error', 'Join or start a household to use AI features.');
  end if;
  if is_import then
    -- One person at a time, so two quick taps can't both squeeze past the cap.
    perform pg_advisory_xact_lock(hashtext(auth.uid()::text));
    select count(*) into used from ai_calls c
      where c.user_id = auth.uid() and c.is_import and c.created_at > now() - interval '24 hours';
    if used >= daily_imports then
      return jsonb_build_object('ok', false, 'limit', true,
        'error', format('You''ve used your %s recipe imports for the last 24 hours. Try again later, or add it by hand.', daily_imports));
    end if;
  end if;
  insert into ai_calls (user_id, is_import) values (auth.uid(), is_import);
  delete from ai_calls where user_id = auth.uid() and created_at < now() - interval '2 days';
  return jsonb_build_object('ok', true,
    'remaining', case when is_import then daily_imports - used - 1 end);
end $$;

revoke execute on function remove_household_member(uuid), claim_ai_call(boolean) from public, anon;
grant execute on function remove_household_member(uuid), claim_ai_call(boolean) to authenticated;
revoke execute on function handle_new_user() from public, anon, authenticated;
