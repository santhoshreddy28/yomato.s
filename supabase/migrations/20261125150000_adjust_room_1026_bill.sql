-- One-time correction for the active Food order in room 1026.
-- Only an open order whose current bill is exactly ₹60 is changed.
update public.orders
set subtotal = 40,
    discount = 0,
    total = 40
where business = 'food'
  and room = '1026'
  and total = 60
  and status not in ('Delivered', 'Cancelled');
