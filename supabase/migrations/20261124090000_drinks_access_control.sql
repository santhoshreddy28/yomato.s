-- Independent fresh-juice availability. Food booking shifts do not control this section.
create table if not exists public.drinks_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  next_open_at timestamptz,
  updated_at timestamptz not null default now()
);
insert into public.drinks_settings (id, enabled, next_open_at)
values (true, false, now() + interval '37 hours')
on conflict (id) do nothing;

alter table public.drinks_settings enable row level security;
drop policy if exists drinks_settings_read on public.drinks_settings;
create policy drinks_settings_read on public.drinks_settings
for select to authenticated using (true);

create or replace function public.get_drinks_config()
returns public.drinks_settings
language sql stable security definer set search_path = public as $$
  select * from public.drinks_settings where id = true;
$$;
revoke all on function public.get_drinks_config() from public, anon;
grant execute on function public.get_drinks_config() to authenticated;

create or replace function public.save_drinks_config(p_enabled boolean, p_next_open_at timestamptz)
returns public.drinks_settings
language plpgsql security definer set search_path = public as $$
declare r public.drinks_settings;
begin
  if not public.is_admin() then raise exception 'Not allowed'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and business in ('drinks','both')) then
    raise exception 'Drinks admin access required';
  end if;
  update public.drinks_settings set enabled = p_enabled, next_open_at = case when p_enabled then null else p_next_open_at end, updated_at = now() where id = true returning * into r;
  return r;
end;
$$;
revoke all on function public.save_drinks_config(boolean, timestamptz) from public, anon;
grant execute on function public.save_drinks_config(boolean, timestamptz) to authenticated;
