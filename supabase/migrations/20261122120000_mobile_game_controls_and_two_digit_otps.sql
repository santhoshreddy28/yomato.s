-- Mobile delivery layout is handled in the client; keep game rules and OTP limits authoritative here.

-- Two-digit codes are order-scoped. They intentionally may repeat across separate orders,
-- because a globally unique two-digit code would run out after only 100 orders.
alter table private.order_delivery_otps drop constraint if exists order_delivery_otps_otp_key;
alter table private.order_delivery_otps drop constraint if exists order_delivery_otps_otp_check;
alter table private.order_delivery_otps drop constraint if exists order_delivery_otps_attempts_check;
update private.order_delivery_otps set otp = lpad((get_byte(extensions.gen_random_bytes(1), 0) % 100)::text, 2, '0'),
  attempts = least(attempts, 3);
alter table private.order_delivery_otps
  add constraint order_delivery_otps_otp_check check (otp ~ '^[0-9]{2}$'),
  add constraint order_delivery_otps_attempts_check check (attempts between 0 and 3);

create or replace function private.create_order_delivery_otp()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_byte bytea;
begin
  v_byte := extensions.gen_random_bytes(1);
  insert into private.order_delivery_otps(order_id, otp)
  values (new.id, lpad((get_byte(v_byte, 0) % 100)::text, 2, '0'));
  return new;
end;
$$;
revoke all on function private.create_order_delivery_otp() from public, anon, authenticated;

create or replace function public.verify_delivery_otp(p_id uuid, p_otp text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare o public.orders; s private.order_delivery_otps; v_left integer;
begin
  if auth.uid() is null or public.my_role() <> 'delivery' then raise exception 'Not allowed'; end if;
  select * into o from public.orders where id = p_id for update;
  if not found then raise exception 'Order not found'; end if;
  if o.status <> 'Out for delivery' then raise exception 'Order is not out for delivery'; end if;
  select * into s from private.order_delivery_otps where order_id = p_id for update;
  if not found then raise exception 'Delivery OTP is not available'; end if;
  if s.attempts >= 3 then return jsonb_build_object('ok', false, 'message', 'Too many attempts. Ask the admin for help.', 'attempts_left', 0); end if;
  if coalesce(p_otp !~ '^[0-9]{2}$', true) or p_otp is distinct from s.otp then
    update private.order_delivery_otps set attempts = attempts + 1 where order_id = p_id;
    v_left := greatest(0, 2 - s.attempts);
    return jsonb_build_object('ok', false, 'message', 'That OTP is incorrect.', 'attempts_left', v_left);
  end if;
  update private.order_delivery_otps set verified_at = clock_timestamp() where order_id = p_id;
  update public.orders set status = 'Delivered' where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.verify_delivery_otp(uuid, text) from public, anon;
grant execute on function public.verify_delivery_otp(uuid, text) to authenticated;

-- Persist a single play per profile. A prior challenge counts as a used chance.
alter table public.profiles add column if not exists game_played boolean not null default false;
update public.profiles p set game_played = true
where exists (select 1 from public.game_challenges c where c.user_id = p.id);

create or replace function private.guard_game_played()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.game_played and not new.game_played then raise exception 'A used game chance cannot be restored'; end if;
  return new;
end;
$$;
revoke all on function private.guard_game_played() from public, anon, authenticated;
drop trigger if exists guard_game_played on public.profiles;
create trigger guard_game_played before update of game_played on public.profiles
for each row execute function private.guard_game_played();

create table if not exists public.game_config (
  id smallint primary key check (id = 1),
  enabled boolean not null default true,
  max_discount numeric not null default 10 check (max_discount between 0 and 10),
  target_speed numeric not null default 2.4 check (target_speed between 1 and 3.5),
  updated_at timestamptz not null default now()
);
insert into public.game_config(id, enabled, max_discount, target_speed) values (1, true, 10, 2.4)
on conflict (id) do nothing;
alter table public.game_config enable row level security;
revoke all on public.game_config from public, anon, authenticated;

alter table public.game_challenges
  add column if not exists target_speed numeric not null default 2.4,
  add column if not exists discount_limit numeric not null default 10;
alter table public.game_challenges
  add constraint game_challenges_target_speed_check check (target_speed between 1 and 3.5) not valid,
  add constraint game_challenges_discount_limit_check check (discount_limit between 0 and 10) not valid;
alter table public.game_challenges validate constraint game_challenges_target_speed_check;
alter table public.game_challenges validate constraint game_challenges_discount_limit_check;

create or replace function public.get_game_config()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c public.game_config;
begin
  if auth.uid() is null then raise exception 'Please sign in'; end if;
  select * into c from public.game_config where id = 1;
  return jsonb_build_object('enabled', c.enabled, 'maxDiscount', c.max_discount, 'targetSpeed', c.target_speed);
end;
$$;
revoke all on function public.get_game_config() from public, anon;
grant execute on function public.get_game_config() to authenticated;

create or replace function public.save_game_config(p_enabled boolean, p_max_discount numeric, p_target_speed numeric)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.game_config;
begin
  if auth.uid() is null or public.my_role() <> 'admin' then raise exception 'Not allowed'; end if;
  if p_max_discount is null or p_max_discount < 0 or p_max_discount > 10 then raise exception 'Maximum discount must be between ₹0 and ₹10'; end if;
  if p_target_speed is null or p_target_speed < 1 or p_target_speed > 3.5 then raise exception 'Target speed must be between 1 and 3.5'; end if;
  update public.game_config set enabled = coalesce(p_enabled, false), max_discount = p_max_discount,
    target_speed = p_target_speed, updated_at = now() where id = 1 returning * into c;
  return jsonb_build_object('enabled', c.enabled, 'maxDiscount', c.max_discount, 'targetSpeed', c.target_speed);
end;
$$;
revoke all on function public.save_game_config(boolean, numeric, numeric) from public, anon;
grant execute on function public.save_game_config(boolean, numeric, numeric) to authenticated;

drop function if exists public.start_game();
create function public.start_game()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.game_config; v_id uuid;
begin
  if auth.uid() is null or public.my_role() <> 'student' then raise exception 'Not allowed'; end if;
  select * into c from public.game_config where id = 1;
  if not c.enabled then raise exception 'The game is temporarily unavailable'; end if;
  update public.profiles set game_played = true where id = auth.uid() and not game_played;
  if not found then raise exception 'You have already used your game chance'; end if;
  insert into public.game_challenges(user_id, target_speed, discount_limit)
    values (auth.uid(), c.target_speed, c.max_discount) returning id into v_id;
  return jsonb_build_object('id', v_id, 'target_speed', c.target_speed, 'max_discount', c.max_discount);
end;
$$;
revoke all on function public.start_game() from public, anon;
grant execute on function public.start_game() to authenticated;

create or replace function public.discount_for(packs integer, subtotal numeric, hit boolean, arrows integer, accuracy numeric)
returns numeric language sql immutable as $$
  select least(10, subtotal, greatest(0, lo + floor((hi - lo) * case when hit then greatest(0, least(1, accuracy)) else 0 end) - greatest(0, arrows - 1)))
  from (select case when packs >= 8 then 10 else (array[3,4,5,6,7,8,9])[greatest(1, least(7, packs))] end as lo,
               case when packs >= 8 then 20 else (array[5,8,10,12,14,16,18])[greatest(1, least(7, packs))] end as hi) t
$$;

create or replace function public.submit_game(p_id uuid, p_shots jsonb, p_played_ms integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.game_challenges; v_count integer; v_at integer; v_prev integer := -1;
  v_angle double precision; v_flight integer; v_step integer; v_x double precision; v_y double precision;
  v_tx double precision; v_ty double precision; v_dist double precision; v_best double precision := 999;
  v_hit boolean := false; v_accuracy numeric := 0; v_bullseye boolean := false; shot jsonb;
begin
  if auth.uid() is null then raise exception 'Please sign in'; end if;
  select * into c from public.game_challenges where id = p_id and user_id = auth.uid() and not used and hit is null and now() <= expires_at for update;
  if not found then return jsonb_build_object('hit', null, 'bullseye', false, 'accuracy', 0, 'arrows', 0); end if;
  if p_shots is null or jsonb_typeof(p_shots) is distinct from 'array' then raise exception 'Invalid game result'; end if;
  v_count := jsonb_array_length(p_shots);
  if v_count < 1 or v_count > 4 or p_played_ms is null or p_played_ms < v_count * 350 or p_played_ms > 30000 then raise exception 'Invalid game result'; end if;
  for shot in select value from jsonb_array_elements(p_shots) as items(value) loop
    v_at := (shot->>'at_ms')::integer; v_angle := (shot->>'angle')::double precision;
    if v_at is null or v_angle is null or v_at <= v_prev or v_at < 0 or v_at > p_played_ms or (v_prev >= 0 and v_at - v_prev < 350) or v_angle <= -3.141593 or v_angle >= 0 then raise exception 'Invalid shot data'; end if;
    v_prev := v_at; v_best := 999;
    for v_step in 1..560 loop
      v_flight := v_step * 4;
      v_x := 180 + cos(v_angle) * (18 + 14 * (v_flight / 16.67));
      v_y := 546 + sin(v_angle) * (18 + 14 * (v_flight / 16.67));
      exit when v_y < -30 or v_x < -30 or v_x > 390 or v_y > 670;
      v_tx := 180 + sin((v_at + v_flight) * 0.00055 * c.target_speed) * 100 + sin((v_at + v_flight) * 0.0013 * c.target_speed + 1) * 22;
      v_ty := 130 + sin((v_at + v_flight) * 0.00045 * c.target_speed) * 8;
      v_dist := sqrt(power(v_x-v_tx,2) + power(v_y-v_ty,2));
      if v_dist < v_best then v_best := v_dist; end if;
      if v_dist < 38 then v_hit := true; exit; end if;
    end loop;
    exit when v_hit;
  end loop;
  v_bullseye := v_hit and v_best <= 3.8;
  if v_bullseye then v_accuracy := 1; elsif v_hit then v_accuracy := greatest(0, least(1, 1 - v_best / 38)); end if;
  update public.game_challenges set hit = v_hit, arrows_used = v_count, played_ms = p_played_ms,
    accuracy = v_accuracy, used = false where id = p_id;
  return jsonb_build_object('hit', v_hit, 'bullseye', v_bullseye, 'accuracy', v_accuracy, 'arrows', v_count);
end;
$$;
revoke all on function public.submit_game(uuid, jsonb, integer) from public, anon;
grant execute on function public.submit_game(uuid, jsonb, integer) to authenticated;

-- Use the reward ceiling captured when this user's one-time game started.
create or replace function public.place_order(p_key uuid, p_items jsonb, p_details jsonb, p_challenge uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_t time := (now() at time zone 'Asia/Kolkata')::time; v_open time; v_close time; v_shift smallint := 1;
  v_order uuid; v_sub numeric := 0; v_packs int := 0; v_disc numeric := 0; v_room text; v_n int; v_ids int;
  r record; c public.game_challenges;
begin
  if auth.uid() is null then raise exception 'Please sign in'; end if;
  select id into v_order from public.orders where idempotency_key = p_key and user_id = auth.uid();
  if found then return v_order; end if;
  v_room := regexp_replace(coalesce(p_details->>'room',''), '\D', '', 'g');
  if length(trim(coalesce(p_details->>'name',''))) < 1 then raise exception 'Enter your name'; end if;
  if coalesce(p_details->>'phone','') !~ '^\d{10}$' then raise exception 'Enter a valid 10-digit mobile number'; end if;
  if coalesce(p_details->>'block','') not in ('A','B') then raise exception 'Choose Block A or B'; end if;
  if v_room !~ '^\d{3,4}$' then raise exception 'Enter a valid room number'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Empty order'; end if;
  select count(*), count(distinct e->>'id') into v_n, v_ids from jsonb_array_elements(p_items) e;
  if v_n <> v_ids then raise exception 'Duplicate items'; end if;
  select open_t, close_t into v_open, v_close from public.shift_config where id = 1;
  if v_open is null or v_close is null or v_open = v_close or
     (case when v_close > v_open then v_t >= v_open and v_t < v_close else v_t >= v_open or v_t < v_close end) is not true then
    raise exception 'Booking is closed'; end if;
  v_n := 0;
  for r in select m.id, m.name, m.price, m.stock, m.is_available, (e->>'qty')::int as qty
    from jsonb_array_elements(p_items) e join public.menu_items m on m.id = (e->>'id')::uuid for update of m loop
    if not r.is_available or r.qty < 1 or r.qty > 99 or (r.stock is not null and r.stock < r.qty) then raise exception 'Item unavailable: %', r.name; end if;
    v_sub := v_sub + r.price * r.qty; v_packs := v_packs + r.qty; v_n := v_n + 1;
  end loop;
  if v_n <> jsonb_array_length(p_items) then raise exception 'Item no longer on the menu'; end if;
  if p_challenge is not null then
    select * into c from public.game_challenges where id = p_challenge and user_id = auth.uid() and not used and hit is not null for update;
    if found then
      v_disc := least(c.discount_limit, public.discount_for(v_packs, v_sub, c.hit, c.arrows_used, coalesce(c.accuracy,0)));
      update public.game_challenges set used = true where id = c.id;
    end if;
  end if;
  insert into public.orders(user_id, customer_name, phone, block, floor, room, subtotal, discount, total, shift, idempotency_key)
  values (auth.uid(), left(trim(p_details->>'name'), 80), p_details->>'phone', p_details->>'block', v_room::int / 100, v_room,
    v_sub, v_disc, v_sub-v_disc, v_shift, p_key) returning id into v_order;
  insert into public.order_items(order_id, menu_item_id, item_name, quantity, unit_price)
    select v_order, m.id, m.name, (e->>'qty')::int, m.price from jsonb_array_elements(p_items) e join public.menu_items m on m.id = (e->>'id')::uuid;
  update public.menu_items m set stock = stock - (e->>'qty')::int from jsonb_array_elements(p_items) e
    where m.id = (e->>'id')::uuid and m.stock is not null;
  update public.profiles set full_name = left(trim(p_details->>'name'), 80), phone = p_details->>'phone', block = p_details->>'block',
    floor = v_room::int / 100, room = v_room where id = auth.uid();
  return v_order;
end;
$$;
revoke all on function public.place_order(uuid, jsonb, jsonb, uuid) from public, anon;
grant execute on function public.place_order(uuid, jsonb, jsonb, uuid) to authenticated;
