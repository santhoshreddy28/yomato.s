-- First-day offer: a played order receives a game discount between ₹4 and ₹9.
alter table public.game_config drop constraint if exists game_config_max_discount_check;
update public.game_config set max_discount = least(9, greatest(4, max_discount)), updated_at = now() where id = 1;
alter table public.game_config
  add constraint game_config_max_discount_check check (max_discount between 4 and 9);

alter table public.game_challenges drop constraint if exists game_challenges_discount_limit_check;
update public.game_challenges set discount_limit = least(9, greatest(4, discount_limit));
alter table public.game_challenges
  add constraint game_challenges_discount_limit_check check (discount_limit between 4 and 9);

create or replace function public.save_game_config(p_enabled boolean, p_max_discount numeric, p_target_speed numeric)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.game_config;
begin
  if auth.uid() is null or public.my_role() <> 'admin' then raise exception 'Not allowed'; end if;
  if p_max_discount is null or p_max_discount < 4 or p_max_discount > 9 then raise exception 'Maximum discount must be between ₹4 and ₹9'; end if;
  if p_target_speed is null or p_target_speed < 1 or p_target_speed > 3.5 then raise exception 'Target speed must be between 1 and 3.5'; end if;
  update public.game_config set enabled = coalesce(p_enabled, false), max_discount = p_max_discount,
    target_speed = p_target_speed, updated_at = now() where id = 1 returning * into c;
  return jsonb_build_object('enabled', c.enabled, 'maxDiscount', c.max_discount, 'targetSpeed', c.target_speed);
end;
$$;
revoke all on function public.save_game_config(boolean, numeric, numeric) from public, anon;
grant execute on function public.save_game_config(boolean, numeric, numeric) to authenticated;

create or replace function public.discount_for(packs integer, subtotal numeric, hit boolean, arrows integer, accuracy numeric)
returns numeric language sql immutable as $$
  select least(9, subtotal, 4 + floor(5 * case when hit then greatest(0, least(1, accuracy)) else 0 end))
$$;
