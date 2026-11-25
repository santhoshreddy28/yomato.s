-- Correct only the delivered Food order shown as AN-100026:
-- Room 1026, Gagan, Pudina Rice, currently billed at ₹65.
-- Keep the recorded subtotal and express the correction as the discount.
update public.orders
set discount = subtotal - 40,
    total = 40
where business = 'food'
  and to_jsonb(public.orders)->>'code' = 'AN-100026'
  and room = '1026'
  and customer_name = 'Gagan'
  and total = 65
  and status = 'Delivered';
