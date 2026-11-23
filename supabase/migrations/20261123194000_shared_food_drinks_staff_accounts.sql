-- The existing admin and delivery emails manage both services.
alter table public.profiles drop constraint if exists profiles_business_check;
alter table public.profiles add constraint profiles_business_check check (business in ('food','drinks','both'));

update public.profiles p
set business = 'both'
from auth.users u
where u.id = p.id and lower(u.email) in ('admin@yomato.in','delivery@yomato.in');

drop policy if exists menu_read on public.menu_items;
drop policy if exists menu_admin_insert on public.menu_items;
drop policy if exists menu_admin_update on public.menu_items;
drop policy if exists menu_admin_delete on public.menu_items;
create policy menu_read on public.menu_items for select to authenticated using (
  public.my_role() = 'student' or business = coalesce((select p.business from public.profiles p where p.id = auth.uid()), 'food') or coalesce((select p.business from public.profiles p where p.id = auth.uid()), 'food') = 'both'
);
create policy menu_admin_insert on public.menu_items for insert to authenticated with check (
  public.is_admin() and (business = coalesce((select p.business from public.profiles p where p.id = auth.uid()), 'food') or (select p.business from public.profiles p where p.id = auth.uid()) = 'both')
);
create policy menu_admin_update on public.menu_items for update to authenticated using (
  public.is_admin() and (business = coalesce((select p.business from public.profiles p where p.id = auth.uid()), 'food') or (select p.business from public.profiles p where p.id = auth.uid()) = 'both')
) with check (business in ('food','drinks'));
create policy menu_admin_delete on public.menu_items for delete to authenticated using (
  public.is_admin() and (business = coalesce((select p.business from public.profiles p where p.id = auth.uid()), 'food') or (select p.business from public.profiles p where p.id = auth.uid()) = 'both')
);

drop policy if exists orders_read on public.orders;
create policy orders_read on public.orders for select to authenticated using (
  user_id = auth.uid() or (public.my_role() in ('admin','delivery') and (business = coalesce((select p.business from public.profiles p where p.id = auth.uid()), 'food') or (select p.business from public.profiles p where p.id = auth.uid()) = 'both'))
);

create or replace function public.set_today_meal(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_business text;
begin
  if auth.uid() is null or public.my_role() <> 'admin' then raise exception 'Not allowed'; end if;
  select business into v_business from public.profiles where id = auth.uid();
  if coalesce(v_business,'food') not in ('food','both') then raise exception 'Not allowed'; end if;
  update public.menu_items set is_available = (id = p_id) where business = 'food' and is_available is distinct from (id = p_id);
end;
$$;
revoke all on function public.set_today_meal(uuid) from public, anon;
grant execute on function public.set_today_meal(uuid) to authenticated;
