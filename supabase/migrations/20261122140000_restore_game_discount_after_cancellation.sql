-- Keep a completed one-time game reward available when its order is cancelled before delivery.
alter table public.orders
  add column if not exists game_challenge_id uuid references public.game_challenges(id);
create index if not exists orders_game_challenge_id_idx on public.orders(game_challenge_id)
  where game_challenge_id is not null;

-- If older accounts have several completed but unused game results, retain only the newest one.
with ranked as (
  select id, row_number() over (partition by user_id order by issued_at desc, id desc) as rn
  from public.game_challenges where hit is not null and not used
)
update public.game_challenges c set used = true from ranked r where c.id = r.id and r.rn > 1;

create or replace function public.get_my_game_reward()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c public.game_challenges;
begin
  if auth.uid() is null or public.my_role() <> 'student' then raise exception 'Not allowed'; end if;
  select * into c from public.game_challenges
  where user_id = auth.uid() and not used and hit is not null
  order by issued_at desc, id desc limit 1;
  if not found then return null; end if;
  return jsonb_build_object('id', c.id, 'hit', c.hit, 'bullseye', coalesce(c.accuracy, 0) >= 1,
    'accuracy', coalesce(c.accuracy, 0), 'arrows', c.arrows_used, 'max_discount', c.discount_limit);
end;
$$;
revoke all on function public.get_my_game_reward() from public, anon;
grant execute on function public.get_my_game_reward() to authenticated;

create or replace function public.place_order(p_key uuid, p_items jsonb, p_details jsonb, p_challenge uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_t time := (now() at time zone 'Asia/Kolkata')::time; v_open time; v_close time; v_shift smallint := 1;
  v_order uuid; v_sub numeric := 0; v_packs int := 0; v_disc numeric := 0; v_room text; v_n int; v_ids int;
  v_challenge uuid; r record; c public.game_challenges;
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
  else
    select * into c from public.game_challenges where user_id = auth.uid() and not used and hit is not null
      order by issued_at desc, id desc limit 1 for update;
  end if;
  if found then
    v_disc := least(c.discount_limit, public.discount_for(v_packs, v_sub, c.hit, c.arrows_used, coalesce(c.accuracy,0)));
    v_challenge := c.id;
    update public.game_challenges set used = true where id = c.id;
  end if;
  insert into public.orders(user_id, customer_name, phone, block, floor, room, subtotal, discount, total, shift, idempotency_key, game_challenge_id)
  values (auth.uid(), left(trim(p_details->>'name'), 80), p_details->>'phone', p_details->>'block', v_room::int / 100, v_room,
    v_sub, v_disc, v_sub-v_disc, v_shift, p_key, v_challenge) returning id into v_order;
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

create or replace function public.cancel_my_order(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare o public.orders;
begin
  if auth.uid() is null or public.my_role() <> 'student' then raise exception 'Not allowed'; end if;
  select * into o from public.orders where id = p_id and user_id = auth.uid() for update;
  if not found then raise exception 'Order not found'; end if;
  if o.status in ('Out for delivery', 'Delivered', 'Cancelled') then raise exception 'This order can no longer be cancelled'; end if;
  update public.menu_items m set stock = m.stock + i.quantity
    from public.order_items i where i.order_id = o.id and m.id = i.menu_item_id and m.stock is not null;
  update public.orders set status = 'Cancelled' where id = o.id;
  if o.game_challenge_id is not null then
    update public.game_challenges set used = false where id = o.game_challenge_id and user_id = auth.uid();
  end if;
end;
$$;
revoke all on function public.cancel_my_order(uuid) from public, anon;
grant execute on function public.cancel_my_order(uuid) to authenticated;
