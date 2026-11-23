-- One-time cleanup: permanently remove cancelled orders and their dependent data.
-- This does not remove student profiles or active/completed orders.
begin;

delete from private.order_delivery_otps
where order_id in (select id from public.orders where status = 'Cancelled');

delete from public.order_items
where order_id in (select id from public.orders where status = 'Cancelled');

delete from public.orders
where status = 'Cancelled';

commit;

-- Storage estimate for database tables (quota is shown in Supabase Settings > Usage).
select
  pg_size_pretty(pg_database_size(current_database())) as database_used,
  pg_database_size(current_database()) as database_used_bytes;
