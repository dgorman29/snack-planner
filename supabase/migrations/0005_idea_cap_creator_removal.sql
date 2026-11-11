-- Caps AI snack ideas at 5 per person per 24 hours (alongside 10 imports), and
-- lets only a household's creator remove members.

/* ------------------------------------------------------ AI call kinds */

alter table ai_calls add column kind text not null default 'other'
  check (kind in ('import', 'ideas', 'sort', 'other'));
update ai_calls set kind = case when is_import then 'import' else 'other' end;
alter table ai_calls drop column is_import;
drop index if exists ai_calls_user_time;
create index ai_calls_user_kind_time on ai_calls (user_id, kind, created_at);

drop function if exists claim_ai_call(boolean);

-- Called by the snack-ai Edge Function, with the caller's own token, before
-- every Anthropic request. The function decides the kind: 'import' for calls
-- that read a web page or photos, otherwise 'sort' or 'ideas' as the app says.
-- Per person, per rolling 24 hours: 10 imports, 5 idea requests; sorting is
-- not capped. Returns { ok, error?, limit?, remaining? }.
create function claim_ai_call(call_kind text) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare used int;
  cap int := case call_kind when 'import' then 10 when 'ideas' then 5 end;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'Not signed in'); end if;
  if call_kind not in ('import', 'ideas', 'sort') then
    return jsonb_build_object('ok', false, 'error', 'Unknown kind of AI call');
  end if;
  if my_household_id() is null then
    return jsonb_build_object('ok', false, 'error', 'Join or start a household to use AI features.');
  end if;
  if cap is not null then
    -- One person at a time, so two quick taps can't both squeeze past the cap.
    perform pg_advisory_xact_lock(hashtext(auth.uid()::text));
    select count(*) into used from ai_calls c
      where c.user_id = auth.uid() and c.kind = call_kind and c.created_at > now() - interval '24 hours';
    if used >= cap then
      return jsonb_build_object('ok', false, 'limit', true, 'error', format(
        case call_kind
          when 'import' then 'You''ve used your %s recipe imports for the last 24 hours. Try again later, or add it by hand.'
          else 'You''ve used your %s snack idea requests for the last 24 hours. Try again later.'
        end, cap));
    end if;
  end if;
  insert into ai_calls (user_id, kind) values (auth.uid(), call_kind);
  delete from ai_calls where user_id = auth.uid() and created_at < now() - interval '2 days';
  return jsonb_build_object('ok', true, 'remaining', cap - used - 1);
end $$;

revoke execute on function claim_ai_call(text) from public, anon;
grant execute on function claim_ai_call(text) to authenticated;

/* ------------------------------------------- creator removes members */

-- Households made before this have no creator recorded ("Our household" from
-- migration 0003). Its earliest account becomes the creator; change
-- households.created_by in the Table Editor if that's the wrong person.
update households h set created_by = (
  select m.user_id from household_members m join auth.users u on u.id = m.user_id
  where m.household_id = h.id order by u.created_at limit 1)
where created_by is null;

create or replace function remove_household_member(member_id uuid) returns void
  language plpgsql security definer set search_path = public as $$
declare hid uuid := my_household_id();
begin
  if hid is null then raise exception 'Not in a household'; end if;
  if member_id = auth.uid() then raise exception 'Use "Leave household" to remove yourself'; end if;
  if not exists (select 1 from households where id = hid and created_by = auth.uid()) then
    raise exception 'Only the person who created this household can remove members';
  end if;
  delete from household_members where user_id = member_id and household_id = hid;
  if not found then raise exception 'That person isn''t in your household'; end if;
end $$;

-- When the creator leaves, the longest-standing remaining member takes over,
-- so someone can still remove members. The last member out deletes it.
create or replace function leave_household() returns void
  language plpgsql security definer set search_path = public as $$
declare hid uuid := my_household_id();
begin
  if hid is null then return; end if;
  delete from household_members where user_id = auth.uid();
  if not exists (select 1 from household_members where household_id = hid) then
    delete from households where id = hid;
  else
    update households set created_by = (
      select user_id from household_members where household_id = hid order by joined_at limit 1)
    where id = hid and created_by is not distinct from auth.uid();
  end if;
end $$;

-- created_by decides who can remove members, so members can no longer edit
-- households directly (renaming and the sharing switch move to functions).
drop policy if exists "members update" on households;

create function update_household(new_name text default null, share boolean default null) returns void
  language plpgsql security definer set search_path = public as $$
declare hid uuid := my_household_id();
begin
  if hid is null then raise exception 'Not in a household'; end if;
  update households set
    name = coalesce(nullif(trim(new_name), ''), name),
    share_library = coalesce(share, share_library)
  where id = hid;
end $$;

revoke execute on function update_household(text, boolean) from public, anon;
grant execute on function update_household(text, boolean) to authenticated;
