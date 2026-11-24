-- Repair only legacy orders labelled as drinks that contain a food item.
update public.orders o
set business = 'food'
where o.business = 'drinks' and exists (
  select 1
  from public.order_items oi
  join public.menu_items m on m.id = oi.menu_item_id
  where oi.order_id = o.id and m.business = 'food'
);

create or replace function public.set_order_status_for_business(p_id uuid, p_status text, p_business text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  o public.orders;
  role_ text := public.my_role();
  order_business text;
begin
  if role_ is null or role_ not in ('admin', 'delivery') then raise exception 'Not allowed'; end if;
  if p_business not in ('food', 'drinks') then raise exception 'Invalid service'; end if;
  select * into o from public.orders where id = p_id for update;
  if not found then raise exception 'Order not found'; end if;
  order_business := case when exists (
    select 1 from public.order_items oi
    join public.menu_items m on m.id = oi.menu_item_id
    where oi.order_id = o.id and m.business = 'drinks'
  ) then 'drinks' else 'food' end;
  if order_business <> p_business then raise exception 'This order belongs to another service'; end if;
  if role_ = 'delivery' and public.my_business() not in (p_business, 'both') then raise exception 'Not allowed'; end if;
  if o.status in ('Cancelled', 'Delivered') then raise exception '% orders are final', o.status; end if;
  if p_status = 'Delivered' then raise exception 'Use delivery OTP verification'; end if;
  if role_ <> 'admin' and not (role_ = 'delivery' and o.status = 'Ready for pickup' and p_status = 'Out for delivery') then
    raise exception 'Not allowed';
  end if;
  if p_status = 'Cancelled' then
    update public.menu_items m set stock = m.stock + i.quantity
    from public.order_items i
    where i.order_id = o.id and m.id = i.menu_item_id and m.stock is not null;
  end if;
  update public.orders set status = p_status, business = order_business where id = p_id;
end;
$$;
revoke all on function public.set_order_status_for_business(uuid, text, text) from public, anon;
grant execute on function public.set_order_status_for_business(uuid, text, text) to authenticated;
