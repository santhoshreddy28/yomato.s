-- Use four-digit delivery OTPs for all new and existing orders.
alter table private.order_delivery_otps drop constraint if exists order_delivery_otps_otp_check;
update private.order_delivery_otps set otp = lpad((
  ((get_byte(extensions.gen_random_bytes(2), 0)::int << 8) + get_byte(extensions.gen_random_bytes(2), 1)::int) % 10000
)::text, 4, '0');
alter table private.order_delivery_otps
  add constraint order_delivery_otps_otp_check check (otp ~ '^[0-9]{4}$');

create or replace function private.create_order_delivery_otp()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_bytes bytea; v_number integer;
begin
  v_bytes := extensions.gen_random_bytes(2);
  v_number := ((get_byte(v_bytes, 0)::int << 8) + get_byte(v_bytes, 1)::int) % 10000;
  insert into private.order_delivery_otps(order_id, otp)
  values (new.id, lpad(v_number::text, 4, '0'));
  return new;
end;
$$;
revoke all on function private.create_order_delivery_otp() from public, anon, authenticated;

create or replace function public.verify_delivery_otp(p_id uuid, p_otp text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare o public.orders; s private.order_delivery_otps; v_left integer;
begin
  if auth.uid() is null or public.my_role() <> 'delivery' then raise exception 'Not allowed'; end if;
  select * into o from public.orders where id = p_id for update;
  if not found then raise exception 'Order not found'; end if;
  if o.status <> 'Out for delivery' then raise exception 'Order is not out for delivery'; end if;
  select * into s from private.order_delivery_otps where order_id = p_id for update;
  if not found then raise exception 'Delivery OTP is not available'; end if;
  if s.attempts >= 3 then return jsonb_build_object('ok', false, 'message', 'Too many attempts. Ask the admin for help.', 'attempts_left', 0); end if;
  if coalesce(p_otp !~ '^[0-9]{4}$', true) or p_otp is distinct from s.otp then
    update private.order_delivery_otps set attempts = attempts + 1 where order_id = p_id;
    v_left := greatest(0, 2 - s.attempts);
    return jsonb_build_object('ok', false, 'message', 'That OTP is incorrect.', 'attempts_left', v_left);
  end if;
  update private.order_delivery_otps set verified_at = clock_timestamp() where order_id = p_id;
  update public.orders set status = 'Delivered' where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.verify_delivery_otp(uuid, text) from public, anon;
grant execute on function public.verify_delivery_otp(uuid, text) to authenticated;
