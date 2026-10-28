-- Save the recipient only when the same transaction can claim its email.
create or replace function public.portal_claim_link_email_to(
  p_request_id uuid, p_link_id uuid, p_customer_name text, p_customer_email text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare l payment_links; e portal_link_emails; result jsonb;
begin
  if p_request_id is null or p_link_id is null or p_customer_name is null or p_customer_email is null or
    length(p_customer_name) not between 1 and 400 or nullif(btrim(p_customer_name),'') is null or p_customer_name ~ '[[:cntrl:]]' or
    length(p_customer_email) not between 3 and 254 or p_customer_email !~ '^[^[:space:]<>"''@]+@[^[:space:]<>"''@]+\.[^[:space:]<>"''@]+$' then raise exception 'invalid email recipient'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,1));
  select * into l from payment_links where id=p_link_id for update;
  if not found then return jsonb_build_object('code','unavailable'); end if;
  select * into e from portal_link_emails where request_id=p_request_id;
  if found then
    if e.payment_link_id<>p_link_id or e.kind<>'payment_link' or e.recipients is distinct from array[p_customer_email] then return jsonb_build_object('code','conflict'); end if;
    return jsonb_build_object('code','existing','state',e.state);
  end if;
  if l.status is distinct from 'pending' or l.cancelled_at is not null or l.expires_at is null or l.expires_at<=now() or
    exists(select 1 from payment_attempts where payment_link_id=p_link_id and state in ('processing','unknown','review')) then return jsonb_build_object('code','unavailable'); end if;
  if l.link_email_status='pending' or exists(select 1 from portal_link_emails where payment_link_id=p_link_id and kind='payment_link' and state='pending') then
    return jsonb_build_object('code','pending','state','pending');
  end if;
  update payment_links set customer_name=p_customer_name,customer_email=p_customer_email where id=p_link_id;
  result:=portal_claim_email(p_request_id,p_link_id,'payment_link');
  if result->>'code' is distinct from 'claimed' then raise exception 'email claim failed'; end if;
  return result;
end $$;
revoke all on function public.portal_claim_link_email_to(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.portal_claim_link_email_to(uuid,uuid,text,text) to service_role;
