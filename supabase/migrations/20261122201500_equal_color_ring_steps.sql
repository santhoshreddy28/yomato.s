-- Calculate a separate payout for each of the four arrows, based on the deepest
-- colored ring reached. The four payouts are added and capped at order subtotal.
alter table public.game_challenges
  add column if not exists arrow_rewards numeric[],
  add column if not exists reward_amount numeric;

create or replace function public.submit_game(p_id uuid, p_shots jsonb, p_played_ms integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.game_challenges; v_count integer; v_at integer; v_prev integer := -1;
  v_angle double precision; v_flight integer; v_step integer; v_x double precision; v_y double precision;
  v_tx double precision; v_ty double precision; v_dist double precision; v_best double precision;
  v_ring integer; v_reward numeric; v_total numeric := 0; v_accuracy numeric := 0;
  v_hit boolean := false; v_bullseye boolean := false; v_rings integer[] := array[]::integer[];
  v_rewards numeric[] := array[]::numeric[]; shot jsonb;
begin
  if auth.uid() is null then raise exception 'Please sign in'; end if;
  select * into c from public.game_challenges where id = p_id and user_id = auth.uid()
    and not used and hit is null and now() <= expires_at for update;
  if not found then return jsonb_build_object('hit', null, 'bullseye', false, 'accuracy', 0, 'arrows', 0); end if;
  if p_shots is null or jsonb_typeof(p_shots) is distinct from 'array' then raise exception 'Invalid game result'; end if;
  v_count := jsonb_array_length(p_shots);
  if v_count < 1 or v_count > 4 or p_played_ms is null or p_played_ms < v_count * 350 or p_played_ms > 30000 then
    raise exception 'Invalid game result';
  end if;
  for shot in select value from jsonb_array_elements(p_shots) as items(value) loop
    v_at := (shot->>'at_ms')::integer; v_angle := (shot->>'angle')::double precision;
    if v_at is null or v_angle is null or v_at <= v_prev or v_at < 0 or v_at > p_played_ms
      or (v_prev >= 0 and v_at - v_prev < 350) or v_angle <= -3.141593 or v_angle >= 0 then
      raise exception 'Invalid shot data';
    end if;
    v_prev := v_at; v_best := 999;
    for v_step in 1..560 loop
      v_flight := v_step * 4;
      v_x := 180 + cos(v_angle) * (18 + 14 * (v_flight / 16.67));
      v_y := 546 + sin(v_angle) * (18 + 14 * (v_flight / 16.67));
      exit when v_y < -30 or v_x < -30 or v_x > 390 or v_y > 670;
      v_tx := 180 + sin((v_at + v_flight) * 0.00055 * c.target_speed) * 100
        + sin((v_at + v_flight) * 0.0013 * c.target_speed + 1) * 22;
      v_ty := 130 + sin((v_at + v_flight) * 0.00045 * c.target_speed) * 8;
      v_dist := sqrt(power(v_x-v_tx, 2) + power(v_y-v_ty, 2));
      if v_dist < v_best then v_best := v_dist; end if;
    end loop;
    v_ring := case when v_best <= 3.8 then 5 when v_best <= 11.4 then 4
      when v_best <= 20.52 then 3 when v_best <= 29.64 then 2
      when v_best <= 38 then 1 else 0 end;
    v_rings := array_append(v_rings, v_ring);
    v_reward := case when v_ring = 0 then 0 else
      c.min_discount / 4 + (c.max_discount - c.min_discount) / 4 * (v_ring::numeric / 5) end;
    v_rewards := array_append(v_rewards, round(v_reward, 4));
    v_total := v_total + v_reward;
    v_accuracy := v_accuracy + v_ring::numeric / 5;
    v_hit := v_hit or v_ring > 0;
    v_bullseye := v_bullseye or v_ring = 5;
  end loop;
  v_accuracy := round(v_accuracy / 4, 4);
  v_total := round(v_total);
  update public.game_challenges set hit = v_hit, arrows_used = v_count, played_ms = p_played_ms,
    accuracy = v_accuracy, arrow_rewards = v_rewards, reward_amount = v_total, used = false where id = p_id;
  return jsonb_build_object('hit', v_hit, 'bullseye', v_bullseye, 'accuracy', v_accuracy,
    'arrows', v_count, 'arrow_rewards', to_jsonb(v_rewards), 'reward_amount', v_total);
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
  if v_discount is null then
    v_discount := coalesce(c.reward_amount, public.game_discount_for(c.accuracy, c.min_discount, c.max_discount));
  end if;
  return jsonb_build_object('id', c.id, 'hit', c.hit, 'bullseye', coalesce(c.accuracy, 0) >= 1,
    'accuracy', coalesce(c.accuracy, 0), 'arrows', c.arrows_used, 'arrow_rewards', c.arrow_rewards,
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
    else v_disc := least(v_sub, coalesce(c.reward_amount, public.game_discount_for(c.accuracy, c.min_discount, c.max_discount))); end if;
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

