-- A new shift schedule or booking day opens a fresh game chance per student.
alter table public.game_config
  add column if not exists cycle_id uuid not null default pg_catalog.gen_random_uuid();
alter table public.game_challenges
  add column if not exists cycle_id uuid,
  add column if not exists cycle_date date;
with ranked as (
  select id, user_id, issued_at, row_number() over(partition by user_id order by issued_at desc, id desc) as rn
  from public.game_challenges
)
update public.game_challenges g set
  cycle_id = case when r.rn = 1 then c.cycle_id else pg_catalog.gen_random_uuid() end,
  cycle_date = (r.issued_at at time zone 'Asia/Kolkata')::date
from ranked r cross join public.game_config c where g.id = r.id and c.id = 1;
alter table public.game_challenges alter column cycle_id set not null, alter column cycle_date set not null;
create index if not exists game_challenges_user_cycle_idx
  on public.game_challenges(user_id, cycle_id, cycle_date);

-- Store one-use admin grants without exposing this data to browser table access.
create table if not exists private.game_replay_grants (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  granted_at timestamptz not null default clock_timestamp(),
  used_at timestamptz
);
revoke all on private.game_replay_grants from public, anon, authenticated;

create or replace function private.mirror_daily_shift()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.id = 1 then
    update public.shift_config set open_t = new.open_t, close_t = new.close_t,
      deliver_start = new.deliver_start, deliver_end = new.deliver_end where id = 2;
    if row(old.open_t, old.close_t, old.deliver_start, old.deliver_end)
       is distinct from row(new.open_t, new.close_t, new.deliver_start, new.deliver_end) then
      update public.game_config set cycle_id = pg_catalog.gen_random_uuid() where id = 1;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.mirror_daily_shift() from public, anon, authenticated;

create or replace function public.get_game_config()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c public.game_config; v_day date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if auth.uid() is null then raise exception 'Please sign in'; end if;
  select * into c from public.game_config where id = 1;
  return jsonb_build_object('enabled', c.enabled, 'maxDiscount', c.max_discount, 'targetSpeed', c.target_speed,
    'cycleId', c.cycle_id::text || ':' || v_day::text,
    'played', public.my_role() = 'student' and exists (
      select 1 from public.game_challenges g where g.user_id = auth.uid() and g.cycle_id = c.cycle_id and g.cycle_date = v_day
    ) and not exists (select 1 from private.game_replay_grants r where r.user_id = auth.uid() and r.used_at is null));
end;
$$;
revoke all on function public.get_game_config() from public, anon;
grant execute on function public.get_game_config() to authenticated;

create or replace function public.start_game()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.game_config; v_day date := (clock_timestamp() at time zone 'Asia/Kolkata')::date;
  v_id uuid; v_played boolean; v_grant boolean;
begin
  if auth.uid() is null or public.my_role() <> 'student' then raise exception 'Not allowed'; end if;
  select * into c from public.game_config where id = 1 for update;
  if not c.enabled then raise exception 'The game is temporarily unavailable'; end if;
  update public.profiles set game_played = true where id = auth.uid();
  if not found then raise exception 'Student profile not found'; end if;
  select exists(select 1 from public.game_challenges g where g.user_id = auth.uid() and g.cycle_id = c.cycle_id and g.cycle_date = v_day)
    into v_played;
  select exists(select 1 from private.game_replay_grants r where r.user_id = auth.uid() and r.used_at is null)
    into v_grant;
  if v_played and not v_grant then raise exception 'You have already used your game chance for this shift'; end if;
  if v_grant then update private.game_replay_grants set used_at = clock_timestamp() where user_id = auth.uid() and used_at is null; end if;
  insert into public.game_challenges(user_id, target_speed, discount_limit, cycle_id, cycle_date)
    values (auth.uid(), c.target_speed, c.max_discount, c.cycle_id, v_day) returning id into v_id;
  return jsonb_build_object('id', v_id, 'target_speed', c.target_speed, 'max_discount', c.max_discount, 'cycle_id', c.cycle_id);
end;
$$;
revoke all on function public.start_game() from public, anon;
grant execute on function public.start_game() to authenticated;

create or replace function public.grant_game_replay(p_phone text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid; v_count integer;
begin
  if auth.uid() is null or public.my_role() <> 'admin' then raise exception 'Not allowed'; end if;
  if coalesce(p_phone,'') !~ '^[0-9]{10}$' then raise exception 'Enter the student’s 10-digit registered mobile number'; end if;
  select count(*), (array_agg(id order by created_at desc))[1] into v_count, v_user
  from public.profiles where role = 'student' and phone = p_phone;
  if v_count = 0 then raise exception 'No student account matches that mobile number'; end if;
  if v_count > 1 then raise exception 'More than one student account matches that number'; end if;
  insert into private.game_replay_grants(user_id, granted_at, used_at)
  values (v_user, clock_timestamp(), null)
  on conflict (user_id) do update set granted_at = excluded.granted_at, used_at = null;
end;
$$;
revoke all on function public.grant_game_replay(text) from public, anon;
grant execute on function public.grant_game_replay(text) to authenticated;
