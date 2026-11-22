-- The reward is the average of four arrow scores, not the user's best single arrow.
create or replace function public.submit_game(p_id uuid, p_shots jsonb, p_played_ms integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.game_challenges; v_count integer; v_at integer; v_prev integer := -1;
  v_angle double precision; v_flight integer; v_step integer; v_x double precision; v_y double precision;
  v_tx double precision; v_ty double precision; v_dist double precision;
  v_shot_best double precision; v_shot_accuracy numeric; v_score_total numeric := 0;
  v_hit boolean := false; v_accuracy numeric := 0; v_bullseye boolean := false; shot jsonb;
begin
  if auth.uid() is null then raise exception 'Please sign in'; end if;
  select * into c from public.game_challenges where id = p_id and user_id = auth.uid()
    and not used and hit is null and now() <= expires_at for update;
  if not found then return jsonb_build_object('hit', null, 'bullseye', false, 'accuracy', 0, 'arrows', 0); end if;
  if p_shots is null or jsonb_typeof(p_shots) is distinct from 'array' then raise exception 'Invalid game result'; end if;
  v_count := jsonb_array_length(p_shots);
  if v_count < 1 or v_count > 4 or p_played_ms is null or p_played_ms < v_count * 350 or p_played_ms > 30000 then
    raise exception 'Invalid game result';
  end if;
  for shot in select value from jsonb_array_elements(p_shots) as items(value) loop
    v_at := (shot->>'at_ms')::integer; v_angle := (shot->>'angle')::double precision;
    if v_at is null or v_angle is null or v_at <= v_prev or v_at < 0 or v_at > p_played_ms
      or (v_prev >= 0 and v_at - v_prev < 350) or v_angle <= -3.141593 or v_angle >= 0 then
      raise exception 'Invalid shot data';
    end if;
    v_prev := v_at; v_shot_best := 999;
    for v_step in 1..560 loop
      v_flight := v_step * 4;
      v_x := 180 + cos(v_angle) * (18 + 14 * (v_flight / 16.67));
      v_y := 546 + sin(v_angle) * (18 + 14 * (v_flight / 16.67));
      exit when v_y < -30 or v_x < -30 or v_x > 390 or v_y > 670;
      v_tx := 180 + sin((v_at + v_flight) * 0.00055 * c.target_speed) * 100
        + sin((v_at + v_flight) * 0.0013 * c.target_speed + 1) * 22;
      v_ty := 130 + sin((v_at + v_flight) * 0.00045 * c.target_speed) * 8;
      v_dist := sqrt(power(v_x-v_tx, 2) + power(v_y-v_ty, 2));
      if v_dist < v_shot_best then v_shot_best := v_dist; end if;
    end loop;
    if v_shot_best < 38 then v_hit := true; end if;
    if v_shot_best <= 3.8 then v_bullseye := true; end if;
    v_shot_accuracy := greatest(0, least(1, 1 - v_shot_best / 76));
    v_score_total := v_score_total + v_shot_accuracy;
  end loop;
  -- Always divide by four; a player who fires fewer than four arrows has zeroes for the unused ones.
  v_accuracy := round(greatest(0, least(1, v_score_total / 4)), 4);
  update public.game_challenges set hit = v_hit, arrows_used = v_count, played_ms = p_played_ms,
    accuracy = v_accuracy, used = false where id = p_id;
  return jsonb_build_object('hit', v_hit, 'bullseye', v_bullseye, 'accuracy', v_accuracy, 'arrows', v_count);
end;
$$;
revoke all on function public.submit_game(uuid, jsonb, integer) from public, anon;
grant execute on function public.submit_game(uuid, jsonb, integer) to authenticated;
