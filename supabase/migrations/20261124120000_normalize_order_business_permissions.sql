-- Older Food orders may have a null business value. Normalize them before
-- applying the shared Food/Drinks service check.
update public.orders o
set business = case when exists (
  select 1
  from public.order_items oi
  join public.menu_items m on m.id = oi.menu_item_id
  where oi.order_id = o.id and m.business = 'drinks'
) then 'drinks' else 'food' end
where o.business is null;

create or replace function public.set_order_status(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  o public.orders;
  role_ text := public.my_role();
  order_business text;
begin
  if role_ is null or role_ not in ('admin', 'delivery') then raise exception 'Not allowed'; end if;
  select * into o from public.orders where id = p_id for update;
  if not found then raise exception 'Order not found'; end if;
  order_business := coalesce(o.business, 'food');
  if public.my_business() not in (order_business, 'both') then
    raise exception 'This order belongs to another service';
  end if;
  if o.status = 'Cancelled' then raise exception 'Cancelled orders are final'; end if;
  if o.status = 'Delivered' then raise exception 'Delivered orders are final'; end if;
  if p_status = 'Delivered' then raise exception 'Use delivery OTP verification'; end if;
  if role_ = 'admin' then null;
  elsif role_ = 'delivery' and o.status = 'Ready for pickup' and p_status = 'Out for delivery' then null;
  else raise exception 'Not allowed'; end if;
  if p_status = 'Cancelled' then
    update public.menu_items m set stock = m.stock + i.quantity
    from public.order_items i
    where i.order_id = o.id and m.id = i.menu_item_id and m.stock is not null;
  end if;
  update public.orders set status = p_status where id = p_id;
end;
$$;
revoke all on function public.set_order_status(uuid, text) from public, anon;
grant execute on function public.set_order_status(uuid, text) to authenticated;
