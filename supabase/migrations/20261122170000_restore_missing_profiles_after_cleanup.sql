-- Recreate only profile rows that were removed while the Auth accounts still exist.
-- Order and order-item data are intentionally left untouched.
insert into public.profiles (id, full_name, phone, block, floor, room, role)
select
  u.id,
  left(coalesce(u.raw_user_meta_data->>'full_name', ''), 80),
  left(regexp_replace(coalesce(u.raw_user_meta_data->>'phone', ''), '\D', '', 'g'), 10),
  case when u.raw_user_meta_data->>'block' in ('A', 'B') then u.raw_user_meta_data->>'block' else 'A' end,
  case
    when regexp_replace(coalesce(u.raw_user_meta_data->>'room', ''), '\D', '', 'g') ~ '^\d{3,4}$'
      then regexp_replace(coalesce(u.raw_user_meta_data->>'room', ''), '\D', '', 'g')::integer / 100
    else 0
  end,
  case
    when regexp_replace(coalesce(u.raw_user_meta_data->>'room', ''), '\D', '', 'g') ~ '^\d{3,4}$'
      then regexp_replace(coalesce(u.raw_user_meta_data->>'room', ''), '\D', '', 'g')
    else ''
  end,
  case
    when u.email = 'admin@yomato.in' then 'admin'
    when u.email = 'delivery@yomato.in' then 'delivery'
    else 'student'
  end
from auth.users u
where not exists (
  select 1 from public.profiles p where p.id = u.id
)
on conflict (id) do nothing;
