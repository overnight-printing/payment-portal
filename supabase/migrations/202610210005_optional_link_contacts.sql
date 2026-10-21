-- Copy-only links may omit contacts; direct-email validation stays in the shared API.
create or replace function public.portal_create_link(p_request_id uuid, p_hash text, p_order_number text,
  p_amount numeric, p_customer_name text, p_customer_email text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare l payment_links;
begin
  if p_amount <= 0 or p_amount > 1000000 or round(p_amount,2) <> p_amount or
    length(p_order_number) not between 1 and 200 or p_customer_name is null or p_customer_email is null or
    length(p_customer_name) not between 0 and 400 or length(p_customer_email) not between 0 and 254 or p_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid link'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  select * into l from payment_links where request_id=p_request_id;
  if found then
    if l.payload_hash <> p_hash then return jsonb_build_object('code','conflict'); end if;
    return jsonb_build_object('code','existing','link',to_jsonb(l));
  end if;
  insert into payment_links(request_id,payload_hash,order_number,amount,customer_name,customer_email,status)
    values(p_request_id,p_hash,p_order_number,p_amount,p_customer_name,p_customer_email,'pending') returning * into l;
  return jsonb_build_object('code','created','link',to_jsonb(l));
end $$;

revoke all on function public.portal_create_link(uuid,text,text,numeric,text,text) from public,anon,authenticated;
grant execute on function public.portal_create_link(uuid,text,text,numeric,text,text) to service_role;
