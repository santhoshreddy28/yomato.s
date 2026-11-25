-- Targeted cleanup based on the current service counts. Preserve old drink
-- menu rows for historical order references; they remain unavailable/hidden
-- because the app now loads Food items only.
update public.profiles
set business = 'food'
where business in ('drinks', 'both');

update public.orders
set business = 'food'
where business = 'drinks';
