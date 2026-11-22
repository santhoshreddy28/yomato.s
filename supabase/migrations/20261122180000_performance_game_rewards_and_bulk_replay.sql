-- Score the closest part of every arrow path and let admins configure the reward range.
alter table public.game_config
  add column if not exists min_discount numeric not null default 4;
alter table public.game_config drop constraint if exists game_config_max_discount_check;
alter table public.game_config drop constraint if exists game_config_discount_range_check;
update public.game_config
set min_discount = greatest(0, coalesce(min_discount, 4)),
    max_discount = greatest(greatest(0, coalesce(min_discount, 4)), coalesce(max_discount, 9));
alter table public.game_config
  add constraint game_config_discount_range_check
  check (min_discount >= 0 and max_discount >= min_discount
    and min_discount = trunc(min_discount) and max_discount = trunc(max_discount));

alter table public.game_challenges
  add column if not exists min_discount numeric not null default 4,
  add column if not exists max_discount numeric not null default 9;
alter table public.game_challenges drop constraint if exists game_challenges_discount_limit_check;
update public.game_challenges
set min_discount = 4,
    max_discount = greatest(4, coalesce(discount_limit, 9));
alter table public.game_challenges
  add constraint game_challenges_discount_range_check
  check (min_discount >= 0 and max_discount >= min_discount
    and min_discount = trunc(min_discount) and max_discount = trunc(max_discount));

create or replace function public.game_discount_for(p_accuracy numeric, p_min numeric, p_max numeric)
returns numeric language sql immutable set search_path = '' as $$
  select round(greatest(0, p_min) + (greatest(p_min, p_max) - greatest(0, p_min))
    * greatest(0, least(1, coalesce(p_accuracy, 0))))
$$;
revoke all on function public.game_discount_for(numeric, numeric, numeric) from public, anon;
grant execute on function public.game_discount_for(numeric, numeric, numeric) to authenticated;

create or replace function public.save_game_config(p_enabled boolean, p_min_discount numeric, p_max_discount numeric, p_target_speed numeric)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.game_config;
begin
  if auth.uid() is null or public.my_role() <> 'admin' then raise exception 'Not allowed'; end if;
  if p_min_discount is null or p_max_discount is null or p_min_discount < 0
    or p_max_discount < p_min_discount or p_min_discount <> trunc(p_min_discount)
    or p_max_discount <> trunc(p_max_discount) then
    raise exception 'Enter whole rupee amounts with maximum at least the minimum';
  end if;
  if p_target_speed is null or p_target_speed < 1 or p_target_speed > 3.5 then raise exception 'Target speed must be between 1 and 3.5'; end if;
  update public.game_config set enabled = coalesce(p_enabled, false), min_discount = p_min_discount,
    max_discount = p_max_discount, target_speed = p_target_speed, updated_at = now()
  where id = 1 returning * into c;
  return jsonb_build_object('enabled', c.enabled, 'minDiscount', c.min_discount,
    'maxDiscount', c.max_discount, 'targetSpeed', c.target_speed);
end;
$$;
revoke all on function public.save_game_config(boolean, numeric, numeric, numeric) from public, anon;
grant execute on function public.save_game_config(boolean, numeric, numeric, numeric) to authenticated;

-- Compatibility for already-open clients that still send only the previous maximum.
create or replace function public.save_game_config(p_enabled boolean, p_max_discount numeric, p_target_speed numeric)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_min numeric;
begin
  if auth.uid() is null or public.my_role() <> 'admin' then raise exception 'Not allowed'; end if;
  select min_discount into v_min from public.game_config where id = 1;
  return public.save_game_config(p_enabled, least(v_min, p_max_discount), p_max_discount, p_target_speed);
end;
$$;
revoke all on function public.save_game_config(boolean, numeric, numeric) from public, anon;
grant execute on function public.save_game_config(boolean, numeric, numeric) to authenticated;

create or replace function public.get_game_config()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c public.game_config; v_day date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if auth.uid() is null then raise exception 'Please sign in'; end if;
  select * into c from public.game_config where id = 1;
  return jsonb_build_object('enabled', c.enabled, 'minDiscount', c.min_discount,
    'maxDiscount', c.max_discount, 'targetSpeed', c.target_speed,
    'cycleId', c.cycle_id::text || ':' || v_day::text,
    'played', public.my_role() = 'student' and exists (
      select 1 from public.game_challenges g where g.user_id = auth.uid()
        and g.cycle_id = c.cycle_id and g.cycle_date = v_day
    ) and not exists (
      select 1 from private.game_replay_grants r where r.user_id = auth.uid() and r.used_at is null
    ));
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
  select exists(select 1 from public.game_challenges g where g.user_id = auth.uid()
    and g.cycle_id = c.cycle_id and g.cycle_date = v_day) into v_played;
  select exists(select 1 from private.game_replay_grants r where r.user_id = auth.uid() and r.used_at is null) into v_grant;
  if v_played and not v_grant then raise exception 'You have already used your game chance for this shift'; end if;
  if v_grant then
    update private.game_replay_grants set used_at = clock_timestamp()
    where user_id = auth.uid() and used_at is null;
  end if;
  insert into public.game_challenges(user_id, target_speed, discount_limit, min_discount, max_discount, cycle_id, cycle_date)
    values (auth.uid(), c.target_speed, c.max_discount, c.min_discount, c.max_discount, c.cycle_id, v_day)
    returning id into v_id;
  return jsonb_build_object('id', v_id, 'target_speed', c.target_speed,
    'min_discount', c.min_discount, 'max_discount', c.max_discount, 'cycle_id', c.cycle_id);
end;
$$;
revoke all on function public.start_game() from public, anon;
grant execute on function public.start_game() to authenticated;

create or replace function public.submit_game(p_id uuid, p_shots jsonb, p_played_ms integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.game_challenges; v_count integer; v_at integer; v_prev integer := -1;
  v_angle double precision; v_flight integer; v_step integer; v_x double precision; v_y double precision;
  v_tx double precision; v_ty double precision; v_dist double precision;
  v_best double precision := 999; v_shot_best double precision;
  v_hit boolean := false; v_accuracy numeric := 0; v_bullseye boolean := false; shot jsonb;
begin
  if auth.uid() is null then raise exception 'Please sign in'; end if;
  select * into c from public.game_challenges where id = p_id and user_id = auth.uid()
    and not used and hit is null and now() <= expires_at for update;
  if not found then return jsonb_build_object('hit', null, 'bullseye', false, 'accuracy', 0, 'arrows', 0); end if;
  if p_shots is null or jsonb_typeof(p_shots) is distinct from 'array' then raise exception 'Invalid game result'; end if;
  v_count := jsonb_array_length(p_shots);
  if v_count < 1 or v_count > 4 or p_played_ms is null or p_played_ms < v_count * 350 or p_played_ms > 30000 then raise exception 'Invalid game result'; end if;
  for shot in select value from jsonb_array_elements(p_shots) as items(value) loop
    v_at := (shot->>'at_ms')::integer; v_angle := (shot->>'angle')::double precision;
    if v_at is null or v_angle is null or v_at <= v_prev or v_at < 0 or v_at > p_played_ms
      or (v_prev >= 0 and v_at - v_prev < 350) or v_angle <= -3.141593 or v_angle >= 0 then
      raise exception 'Invalid shot data';
    end if;
    v_prev := v_at; v_shot_best := 999;
    for v_step in 1..560 loop
      v_flight := v_step * 4;
      v_x := 180 + cos(v_angle) * (18 + 14 * (v_flight / 16.67));
      v_y := 546 + sin(v_angle) * (18 + 14 * (v_flight / 16.67));
      exit when v_y < -30 or v_x < -30 or v_x > 390 or v_y > 670;
      v_tx := 180 + sin((v_at + v_flight) * 0.00055 * c.target_speed) * 100
        + sin((v_at + v_flight) * 0.0013 * c.target_speed + 1) * 22;
      v_ty := 130 + sin((v_at + v_flight) * 0.00045 * c.target_speed) * 8;
      v_dist := sqrt(power(v_x-v_tx, 2) + power(v_y-v_ty, 2));
      if v_dist < v_shot_best then v_shot_best := v_dist; end if;
    end loop;
    if v_shot_best < v_best then v_best := v_shot_best; end if;
  end loop;
  v_hit := v_best < 38;
  v_bullseye := v_hit and v_best <= 3.8;
  -- Score proportionally across the full target approach, including close misses.
  v_accuracy := greatest(0, least(1, 1 - v_best / 76));
  update public.game_challenges set hit = v_hit, arrows_used = v_count, played_ms = p_played_ms,
    accuracy = v_accuracy, used = false where id = p_id;
  return jsonb_build_object('hit', v_hit, 'bullseye', v_bullseye, 'accuracy', v_accuracy, 'arrows', v_count);
end;
$$;
revoke all on function public.submit_game(uuid, jsonb, integer) from public, anon;
grant execute on function public.submit_game(uuid, jsonb, integer) to authenticated;

create or replace function public.get_my_game_reward()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c public.game_challenges; v_discount numeric;
begin
  if auth.uid() is null or public.my_role() <> 'student' then raise exception 'Not allowed'; end if;
  select * into c from public.game_challenges where user_id = auth.uid() and not used and hit is not null
    order by issued_at desc, id desc limit 1;
  if not found then return null; end if;
  select discount into v_discount from public.orders where game_challenge_id = c.id and status = 'Cancelled'
    order by created_at desc, id desc limit 1;
  if v_discount is null then v_discount := public.game_discount_for(c.accuracy, c.min_discount, c.max_discount); end if;
  return jsonb_build_object('id', c.id, 'hit', c.hit, 'bullseye', coalesce(c.accuracy, 0) >= 1,
    'accuracy', coalesce(c.accuracy, 0), 'arrows', c.arrows_used,
    'min_discount', c.min_discount, 'max_discount', c.max_discount, 'discount', v_discount);
end;
$$;
revoke all on function public.get_my_game_reward() from public, anon;
grant execute on function public.get_my_game_reward() to authenticated;

create or replace function public.place_order(p_key uuid, p_items jsonb, p_details jsonb, p_challenge uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_t time := (now() at time zone 'Asia/Kolkata')::time; v_open time; v_close time; v_shift smallint := 1;
  v_order uuid; v_sub numeric := 0; v_disc numeric := 0; v_previous_discount numeric;
  v_room text; v_n int; v_ids int; v_challenge uuid; r record; c public.game_challenges;
begin
  if auth.uid() is null then raise exception 'Please sign in'; end if;
  select id into v_order from public.orders where idempotency_key = p_key and user_id = auth.uid();
  if found then return v_order; end if;
  v_room := regexp_replace(coalesce(p_details->>'room', ''), '\D', '', 'g');
  if length(trim(coalesce(p_details->>'name', ''))) < 1 then raise exception 'Enter your name'; end if;
  if coalesce(p_details->>'phone', '') !~ '^\d{10}$' then raise exception 'Enter a valid 10-digit mobile number'; end if;
  if coalesce(p_details->>'block', '') not in ('A', 'B') then raise exception 'Choose Block A or B'; end if;
  if v_room !~ '^\d{3,4}$' then raise exception 'Enter a valid room number'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Empty order'; end if;
  select count(*), count(distinct e->>'id') into v_n, v_ids from jsonb_array_elements(p_items) e;
  if v_n <> v_ids then raise exception 'Duplicate items'; end if;
  select open_t, close_t into v_open, v_close from public.shift_config where id = 1;
  if v_open is null or v_close is null or v_open = v_close or
    (case when v_close > v_open then v_t >= v_open and v_t < v_close else v_t >= v_open or v_t < v_close end) is not true then
    raise exception 'Booking is closed';
  end if;
  v_n := 0;
  for r in select m.id, m.name, m.price, m.stock, m.is_available, (e->>'qty')::int as qty
    from jsonb_array_elements(p_items) e join public.menu_items m on m.id = (e->>'id')::uuid
    for update of m loop
    if not r.is_available or r.qty < 1 or r.qty > 99 or (r.stock is not null and r.stock < r.qty) then
      raise exception 'Item unavailable: %', r.name;
    end if;
    v_sub := v_sub + r.price * r.qty; v_n := v_n + 1;
  end loop;
  if v_n <> jsonb_array_length(p_items) then raise exception 'Item no longer on the menu'; end if;
  if p_challenge is not null then
    select * into c from public.game_challenges where id = p_challenge and user_id = auth.uid() and not used and hit is not null for update;
  else
    select * into c from public.game_challenges where user_id = auth.uid() and not used and hit is not null
      order by issued_at desc, id desc limit 1 for update;
  end if;
  if found then
    select discount into v_previous_discount from public.orders where game_challenge_id = c.id and status = 'Cancelled'
      order by created_at desc, id desc limit 1;
    if v_previous_discount is not null then v_disc := least(v_sub, v_previous_discount);
    else v_disc := least(v_sub, public.game_discount_for(c.accuracy, c.min_discount, c.max_discount)); end if;
    v_challenge := c.id;
    update public.game_challenges set used = true where id = c.id;
  end if;
  insert into public.orders(user_id, customer_name, phone, block, floor, room, subtotal, discount, total, shift, idempotency_key, game_challenge_id)
  values (auth.uid(), left(trim(p_details->>'name'), 80), p_details->>'phone', p_details->>'block', v_room::int / 100,
    v_room, v_sub, v_disc, v_sub-v_disc, v_shift, p_key, v_challenge) returning id into v_order;
  insert into public.order_items(order_id, menu_item_id, item_name, quantity, unit_price)
    select v_order, m.id, m.name, (e->>'qty')::int, m.price from jsonb_array_elements(p_items) e
    join public.menu_items m on m.id = (e->>'id')::uuid;
  update public.menu_items m set stock = stock - (e->>'qty')::int from jsonb_array_elements(p_items) e
    where m.id = (e->>'id')::uuid and m.stock is not null;
  update public.profiles set full_name = left(trim(p_details->>'name'), 80), phone = p_details->>'phone',
    block = p_details->>'block', floor = v_room::int / 100, room = v_room where id = auth.uid();
  return v_order;
end;
$$;
revoke all on function public.place_order(uuid, jsonb, jsonb, uuid) from public, anon;
grant execute on function public.place_order(uuid, jsonb, jsonb, uuid) to authenticated;

create or replace function public.grant_game_replay_all()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_cycle uuid; v_day date := (clock_timestamp() at time zone 'Asia/Kolkata')::date; v_count integer;
begin
  if auth.uid() is null or public.my_role() <> 'admin' then raise exception 'Not allowed'; end if;
  select cycle_id into v_cycle from public.game_config where id = 1;
  with eligible as (
    select distinct g.user_id from public.game_challenges g
    join public.profiles p on p.id = g.user_id and p.role = 'student'
    where g.cycle_id = v_cycle and g.cycle_date = v_day
      and not exists (select 1 from private.game_replay_grants r where r.user_id = g.user_id and r.used_at is null)
  ), granted as (
    insert into private.game_replay_grants(user_id, granted_at, used_at)
    select e.user_id, clock_timestamp(), null from eligible e
    on conflict (user_id) do update set granted_at = excluded.granted_at, used_at = null
      where private.game_replay_grants.used_at is not null
    returning user_id
  ) select count(*) into v_count from granted;
  return v_count;
end;
$$;
revoke all on function public.grant_game_replay_all() from public, anon;
grant execute on function public.grant_game_replay_all() to authenticated;
