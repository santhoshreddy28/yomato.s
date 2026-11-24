-- Seed the requested juice menu items. Prices are starter values and remain
-- editable from Drinks Admin → Fresh juice.
insert into public.menu_items (name, description, price, stock, daily_stock_limit, is_available, business)
select v.name, v.description, v.price, 20, 20, false, 'drinks'
from (values
  ('Jeera Water', 'Chilled cumin-infused water with a fresh finish', 20),
  ('Hot Chocolate', 'Warm, rich chocolate drink', 50),
  ('Black Salt Lemonade', 'Refreshing lemon drink with black salt', 25),
  ('Sugar Lemonade', 'Classic sweet fresh lemonade', 25),
  ('Oreo Shake', 'Creamy chocolate cookie shake', 60),
  ('Banana Shake', 'Smooth banana milkshake', 50),
  ('Cold Coffee', 'Chilled creamy coffee blend', 50)
  ,('Salt Popcorn', 'Lightly salted crunchy popcorn', 35)
  ,('Butter Popcorn', 'Warm popcorn with buttery flavor', 35)
  ,('Chilli Popcorn', 'Crunchy popcorn with a spicy chilli seasoning', 35)
) as v(name, description, price)
where not exists (
  select 1 from public.menu_items m where lower(m.name) = lower(v.name) and m.business = 'drinks'
);
