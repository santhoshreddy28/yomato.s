-- Juice is paused. Treat all existing orders as food orders so legacy service
-- labels cannot block the food admin or delivery workflow.
create or replace function public.set_order_status_for_business(p_id uuid, p_status text, p_business text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  o public.orders;
  role_ text := public.my_role();
begin
  if role_ is null or role_ not in ('admin', 'delivery') then raise exception 'Not allowed'; end if;
  if p_business <> 'food' then raise exception 'Invalid service'; end if;
  select * into o from public.orders where id = p_id for update;
  if not found then raise exception 'Order not found'; end if;
  if role_ = 'delivery' and public.my_business() not in ('food', 'both') then raise exception 'Not allowed'; end if;
  if o.status = 'Cancelled' then raise exception 'Cancelled orders are final'; end if;
  if o.status = 'Delivered' then raise exception 'Delivered orders are final'; end if;
  if p_status = 'Delivered' then raise exception 'Use delivery OTP verification'; end if;
  if role_ <> 'admin' and not (role_ = 'delivery' and o.status = 'Ready for pickup' and p_status = 'Out for delivery') then
    raise exception 'Not allowed';
  end if;
  if p_status = 'Cancelled' then
    update public.menu_items m set stock = m.stock + i.quantity
    from public.order_items i
    where i.order_id = o.id and m.id = i.menu_item_id and m.stock is not null;
  end if;
  update public.orders set status = p_status, business = 'food' where id = p_id;
end;
$$;
revoke all on function public.set_order_status_for_business(uuid, text, text) from public, anon;
grant execute on function public.set_order_status_for_business(uuid, text, text) to authenticated;
