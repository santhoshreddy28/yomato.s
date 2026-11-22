-- Backfill unambiguous legacy reward/order pairs using the original discount formula.
with order_packs as (
  select o.id, o.user_id, o.created_at, o.subtotal, o.discount,
    (select coalesce(sum(i.quantity), 0)::int from public.order_items i where i.order_id = o.id) as packs
  from public.orders o where o.discount > 0 and o.game_challenge_id is null
), exact_pairs as (
  select o.id as order_id, c.id as challenge_id,
    row_number() over (partition by o.id order by c.issued_at desc, c.id desc) as order_pick,
    row_number() over (partition by c.id order by o.created_at, o.id) as challenge_pick
  from order_packs o
  join public.game_challenges c on c.user_id = o.user_id and c.issued_at <= o.created_at and c.used and c.hit is not null
  cross join lateral (
    select case when o.packs >= 8 then 10 else (array[3,4,5,6,7,8,9])[greatest(1,least(7,o.packs))] end as lo,
      case when o.packs >= 8 then 20 else (array[5,8,10,12,14,16,18])[greatest(1,least(7,o.packs))] end as hi
  ) t
  where o.discount = least(o.subtotal, greatest(0,
    t.lo + floor((t.hi - t.lo) * case when c.hit then greatest(0,least(1,coalesce(c.accuracy,0))) else 0 end)
    - greatest(0,coalesce(c.arrows_used,0)-1)))
), matches as (
  select order_id, challenge_id from exact_pairs where order_pick = 1 and challenge_pick = 1
)
update public.orders o set game_challenge_id = m.challenge_id
from matches m where o.id = m.order_id;

-- A previously cancelled order returns its completed one-time reward.
update public.game_challenges c set used = false
from public.orders o where o.game_challenge_id = c.id and o.status = 'Cancelled' and c.hit is not null;

create or replace function public.get_my_game_reward()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c public.game_challenges; v_discount numeric;
begin
  if auth.uid() is null or public.my_role() <> 'student' then raise exception 'Not allowed'; end if;
  select * into c from public.game_challenges
  where user_id = auth.uid() and not used and hit is not null
  order by issued_at desc, id desc limit 1;
  if not found then return null; end if;
  select discount into v_discount from public.orders
  where game_challenge_id = c.id and status = 'Cancelled'
  order by created_at desc, id desc limit 1;
  if v_discount is null then
    v_discount := least(c.discount_limit, public.discount_for(1, 100, c.hit, c.arrows_used, coalesce(c.accuracy,0)));
  end if;
  return jsonb_build_object('id', c.id, 'hit', c.hit, 'bullseye', coalesce(c.accuracy, 0) >= 1,
    'accuracy', coalesce(c.accuracy, 0), 'arrows', c.arrows_used, 'max_discount', c.discount_limit, 'discount', v_discount);
end;
$$;
revoke all on function public.get_my_game_reward() from public, anon;
grant execute on function public.get_my_game_reward() to authenticated;

create or replace function public.place_order(p_key uuid, p_items jsonb, p_details jsonb, p_challenge uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_t time := (now() at time zone 'Asia/Kolkata')::time; v_open time; v_close time; v_shift smallint := 1;
  v_order uuid; v_sub numeric := 0; v_packs int := 0; v_disc numeric := 0; v_previous_discount numeric;
  v_room text; v_n int; v_ids int; v_challenge uuid; r record; c public.game_challenges;
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
    select discount into v_previous_discount from public.orders
    where game_challenge_id = c.id and status = 'Cancelled'
    order by created_at desc, id desc limit 1;
    if v_previous_discount is not null then v_disc := least(v_sub, v_previous_discount);
    else v_disc := least(c.discount_limit, public.discount_for(v_packs, v_sub, c.hit, c.arrows_used, coalesce(c.accuracy,0))); end if;
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
