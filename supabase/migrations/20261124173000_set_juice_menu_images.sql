-- Attach the supplied drink photos to the matching Fresh juice menu items.
update public.menu_items set image = 'jeera-water.jpg'
where business = 'drinks' and lower(name) = 'jeera water';
update public.menu_items set image = 'hot-chocolate.jpg'
where business = 'drinks' and lower(name) = 'hot chocolate';
update public.menu_items set image = 'black-salt-lemonade.jpg'
where business = 'drinks' and lower(name) = 'black salt lemonade';
update public.menu_items set image = 'sugar-lemonade.jpg'
where business = 'drinks' and lower(name) = 'sugar lemonade';
update public.menu_items set image = 'oreo-shake.jpg'
where business = 'drinks' and lower(name) = 'oreo shake';
update public.menu_items set image = 'banana-shake.jpg'
where business = 'drinks' and lower(name) = 'banana shake';
update public.menu_items set image = 'cold-coffee.jpg'
where business = 'drinks' and lower(name) = 'cold coffee';
