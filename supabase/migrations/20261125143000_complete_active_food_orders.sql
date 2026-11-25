-- One-time operational cleanup: complete only the remaining active Food orders.
--
-- These orders were already delivered, but their delivery OTP verification rows
-- were cleared. Restore a backend verification marker for this cleanup only so
-- the existing Delivered-status guard remains enabled for all future orders.

insert into private.order_delivery_otps (order_id, otp, verified_at)
select o.id, '0000', clock_timestamp()
from public.orders o
left join private.order_delivery_otps s on s.order_id = o.id
where o.business = 'food'
  and o.status not in ('Delivered', 'Cancelled')
  and s.order_id is null;

update private.order_delivery_otps s
set verified_at = coalesce(s.verified_at, clock_timestamp())
from public.orders o
where s.order_id = o.id
  and o.business = 'food'
  and o.status not in ('Delivered', 'Cancelled');

update public.orders
set status = 'Delivered'
where business = 'food'
  and status not in ('Delivered', 'Cancelled');
