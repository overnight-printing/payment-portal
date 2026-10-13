begin;

alter table public.payment_links add column if not exists replaces_link_id uuid references public.payment_links(id);
create unique index if not exists payment_links_one_replacement on public.payment_links(replaces_link_id) where replaces_link_id is not null;
alter table public.portal_link_emails
  add column if not exists kind text not null default 'payment_link' check(kind in ('payment_link','customer_receipt','staff_receipt')),
  add column if not exists provider_id uuid,
  add column if not exists recipients text[],
  add column if not exists delivery_status text check(delivery_status in ('accepted','delayed','delivered','bounced','failed','complained','suppressed'));
drop index if exists public.portal_link_emails_one_pending;
create unique index if not exists portal_emails_one_pending_kind on public.portal_link_emails(payment_link_id,kind) where state='pending';
create unique index if not exists portal_emails_provider on public.portal_link_emails(provider_id) where provider_id is not null;
create table if not exists public.portal_email_events (
  event_id text not null check(length(event_id) between 1 and 150),
  request_id uuid not null references public.portal_link_emails(request_id),
  recipient text not null check(length(recipient) between 3 and 254),
  status text not null check(status in ('accepted','delayed','delivered','bounced','failed','complained','suppressed')),
  occurred_at timestamptz not null,
  primary key(event_id,recipient)
);
create index if not exists portal_email_events_request on public.portal_email_events(request_id,recipient,occurred_at desc);
alter table public.portal_email_events enable row level security;
revoke all on public.portal_email_events from public,anon,authenticated;
grant select on public.portal_email_events to service_role;

create or replace function public.portal_claim_email(p_request_id uuid,p_link_id uuid,p_kind text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare l payment_links; e portal_link_emails; recipients text[];
begin
  if p_request_id is null or p_link_id is null or p_kind is null or p_kind not in ('payment_link','customer_receipt','staff_receipt') then raise exception 'invalid email request'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,1));
  select * into l from payment_links where id=p_link_id for update;
  if not found then return jsonb_build_object('code','unavailable'); end if;
  select * into e from portal_link_emails where request_id=p_request_id;
  if found then
    if e.payment_link_id<>p_link_id or e.kind<>p_kind then return jsonb_build_object('code','conflict'); end if;
    return jsonb_build_object('code','existing','state',e.state);
  end if;
  if p_kind='payment_link' then
    if l.status is distinct from 'pending' or l.cancelled_at is not null or l.expires_at is null or l.expires_at<=now() or
      exists(select 1 from payment_attempts where payment_link_id=p_link_id and state in ('processing','unknown','review')) then return jsonb_build_object('code','unavailable'); end if;
    if l.link_email_status='pending' then return jsonb_build_object('code','pending','state','pending'); end if;
  elsif l.status is distinct from 'paid' then return jsonb_build_object('code','unavailable'); end if;
  if exists(select 1 from portal_link_emails where payment_link_id=p_link_id and kind=p_kind and state='pending') then return jsonb_build_object('code','pending','state','pending'); end if;
  recipients:=case when p_kind='staff_receipt' then array['accounting@overnightprintingseattle.com','contact@overnightprintingseattle.com'] else array[l.customer_email] end;
  if p_kind<>'staff_receipt' and (l.customer_email is null or l.customer_email!~'^[^[:space:]<>"@]+@[^[:space:]<>"@]+\.[^[:space:]<>"@]+$') then return jsonb_build_object('code','unavailable'); end if;
  insert into portal_link_emails(request_id,payment_link_id,kind,recipients) values(p_request_id,p_link_id,p_kind,recipients);
  if p_kind='payment_link' then update payment_links set link_email_status='pending' where id=p_link_id; end if;
  return jsonb_build_object('code','claimed','state','pending');
end $$;

create or replace function public.portal_finish_email(p_request_id uuid,p_state text,p_provider_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare e portal_link_emails; outcome text;
begin
  if p_state is null or p_state not in ('pending','accepted','failed') then raise exception 'invalid email outcome'; end if;
  select * into e from portal_link_emails where request_id=p_request_id;
  if not found then raise exception 'missing email request'; end if;
  perform 1 from payment_links where id=e.payment_link_id for update;
  select * into e from portal_link_emails where request_id=p_request_id for update;
  if e.provider_id is not null and p_provider_id is not null and e.provider_id<>p_provider_id then raise exception 'provider mismatch'; end if;
  outcome:=case when e.state='pending' then p_state else e.state end;
  update portal_link_emails set state=outcome,provider_id=coalesce(provider_id,p_provider_id),
    finished_at=case when outcome='pending' then null else coalesce(finished_at,now()) end where request_id=p_request_id;
  if e.kind='payment_link' then update payment_links set link_email_status=outcome,link_email_sent=link_email_sent or outcome='accepted' where id=e.payment_link_id;
  elsif e.kind='customer_receipt' and outcome='accepted' then update payment_links set receipt_sent=true where id=e.payment_link_id; end if;
  return jsonb_build_object('state',outcome);
end $$;

create or replace function public.portal_claim_link_email(p_request_id uuid,p_link_id uuid)
returns jsonb language sql security definer set search_path=public,pg_temp as $$ select portal_claim_email(p_request_id,p_link_id,'payment_link'); $$;
create or replace function public.portal_finish_link_email(p_request_id uuid,p_state text)
returns jsonb language sql security definer set search_path=public,pg_temp as $$ select portal_finish_email(p_request_id,p_state,null); $$;

create or replace function public.portal_record_email_event(p_event_id text,p_provider_id uuid,p_request_id uuid,p_link_id uuid,p_kind text,p_recipients text[],p_status text,p_occurred_at timestamptz)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare e portal_link_emails; target_recipient text; delivery text;
begin
  if p_event_id is null or length(p_event_id) not between 1 and 150 or p_provider_id is null or p_status is null or p_status not in ('accepted','delayed','delivered','bounced','failed','complained','suppressed') or
    p_occurred_at is null or p_occurred_at>now()+interval '5 minutes' or p_recipients is null or exists(select 1 from unnest(p_recipients) recipient where recipient is null) or cardinality(p_recipients) not between 1 and 2 then raise exception 'invalid email event'; end if;
  select * into e from portal_link_emails where provider_id=p_provider_id or request_id=p_request_id order by (provider_id=p_provider_id) desc nulls last limit 1;
  if not found then return jsonb_build_object('code','ignored'); end if;
  perform 1 from payment_links where id=e.payment_link_id for update;
  select * into e from portal_link_emails where request_id=e.request_id for update;
  if (e.provider_id is not null and e.provider_id<>p_provider_id) or (p_request_id is not null and e.request_id<>p_request_id) or
    (p_link_id is not null and e.payment_link_id<>p_link_id) or (p_kind is not null and e.kind<>p_kind) or e.recipients is null or not(p_recipients<@e.recipients) or
    exists(select 1 from portal_link_emails where provider_id=p_provider_id and request_id<>e.request_id) or
    exists(select 1 from portal_email_events where event_id=p_event_id and request_id<>e.request_id) then return jsonb_build_object('code','ignored'); end if;
  foreach target_recipient in array p_recipients loop
    insert into portal_email_events(event_id,request_id,recipient,status,occurred_at) values(p_event_id,e.request_id,target_recipient,p_status,p_occurred_at) on conflict do nothing;
  end loop;
  -- Terminal delivery facts outrank delayed/sent notifications, even when events arrive out of order.
  select case when bool_or(s.status='complained') then 'complained' when bool_or(s.status='suppressed') then 'suppressed'
    when bool_or(s.status='bounced') then 'bounced' when bool_or(s.status='failed') then 'failed'
    when count(*) filter(where s.status='delivered')=cardinality(e.recipients) then 'delivered'
    when bool_or(s.status='delayed') then 'delayed' else 'accepted' end into delivery
  from unnest(e.recipients) r(recipient) left join lateral (
    select status from portal_email_events where request_id=e.request_id and recipient=r.recipient
      order by case status when 'complained' then 4 when 'suppressed' then 3 when 'bounced' then 3 when 'failed' then 3 when 'delivered' then 2 when 'delayed' then 1 else 0 end desc,
        occurred_at desc,event_id desc limit 1
  ) s on true;
  update portal_link_emails set provider_id=p_provider_id,state='accepted',delivery_status=delivery,finished_at=coalesce(finished_at,now()) where request_id=e.request_id;
  if e.kind='payment_link' then update payment_links set link_email_sent=true,link_email_status='accepted' where id=e.payment_link_id;
  elsif e.kind='customer_receipt' then update payment_links set receipt_sent=true where id=e.payment_link_id; end if;
  return jsonb_build_object('code','recorded','state',delivery);
end $$;

create or replace function public.portal_cancel_link(p_link_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare l payment_links;
begin
  select * into l from payment_links where id=p_link_id for update;
  if not found or l.status is distinct from 'pending' or exists(select 1 from payment_attempts where payment_link_id=p_link_id and state in ('processing','unknown','review')) then return jsonb_build_object('code','unavailable'); end if;
  update payment_links set cancelled_at=coalesce(cancelled_at,now()) where id=p_link_id;
  return jsonb_build_object('code','cancelled','id',p_link_id);
end $$;

create or replace function public.portal_replace_link(p_link_id uuid,p_request_id uuid,p_hash text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare l payment_links; successor payment_links; result jsonb;
begin
  if p_request_id is null or p_hash is null or p_hash!~'^[0-9a-f]{64}$' then raise exception 'invalid replacement'; end if;
  select * into l from payment_links where id=p_link_id for update;
  if not found then return jsonb_build_object('code','unavailable'); end if;
  select * into successor from payment_links where request_id=p_request_id;
  if found and (successor.payload_hash is distinct from p_hash or successor.replaces_link_id is distinct from p_link_id) then return jsonb_build_object('code','conflict'); end if;
  select * into successor from payment_links where replaces_link_id=p_link_id;
  if found then return jsonb_build_object('code','existing','id',successor.id); end if;
  if l.status is distinct from 'pending' or l.cancelled_at is not null or l.expires_at is null or l.expires_at>now() or
    exists(select 1 from payment_attempts where payment_link_id=p_link_id and state in ('processing','unknown','review')) or
    l.amount<=0 or l.amount>1000000 or round(l.amount::numeric,2)<>l.amount or nullif(trim(l.customer_name),'') is null or nullif(trim(l.customer_email),'') is null then return jsonb_build_object('code','unavailable'); end if;
  result:=portal_create_link(p_request_id,p_hash,l.order_number,l.amount,l.customer_name,l.customer_email);
  if result->>'code'='conflict' then return jsonb_build_object('code','conflict'); end if;
  select * into successor from payment_links where id=(result->'link'->>'id')::uuid;
  if successor.replaces_link_id is not null and successor.replaces_link_id<>p_link_id then return jsonb_build_object('code','conflict'); end if;
  update payment_links set replaces_link_id=p_link_id,link_email_status='not_requested',expires_at=now()+interval '30 days' where id=successor.id;
  update payment_links set cancelled_at=now() where id=p_link_id;
  return jsonb_build_object('code','replaced','id',successor.id);
end $$;

create or replace view public.portal_staff_links with (security_invoker=true) as
with base as (
 select l.id,l.order_number,l.customer_name,l.customer_email,round(l.amount::numeric,2)::text as amount,l.created_at,l.paid_at,l.expires_at,
  case when nullif(trim(l.customer_email),'') is not null then 'email:'||lower(trim(l.customer_email)) else 'link:'||l.id::text end as customer_key,
  case when l.status='paid' then 'paid' when a.state='review' then 'review' when a.state in ('processing','unknown') then 'processing'
    when l.cancelled_at is not null then 'cancelled' when l.expires_at is null or l.expires_at<=now() then 'expired' else 'unpaid' end as payment_status,
  coalesce(e.delivery_status,e.state,case when l.link_email_status='unknown' and l.link_email_sent then 'accepted' else l.link_email_status end) as email_status,
  coalesce(e.finished_at,e.created_at) as last_email_at,
  coalesce(r.delivery_status,r.state,case when l.receipt_sent then 'accepted' else 'unknown' end) as receipt_status,
  l.replaces_link_id,successor.id as replaced_by
 from payment_links l left join payment_attempts a on a.payment_link_id=l.id and a.state in ('processing','unknown','review')
 left join lateral (select * from portal_link_emails where payment_link_id=l.id and kind='payment_link' order by created_at desc,request_id desc limit 1) e on true
 left join lateral (select * from portal_link_emails where payment_link_id=l.id and kind='customer_receipt' order by created_at desc,request_id desc limit 1) r on true
 left join payment_links successor on successor.replaces_link_id=l.id
)
select base.*,case when payment_status='cancelled' then array[]::text[] else array_remove(array[
 case when payment_status='processing' then 'payment_processing' end,case when payment_status='review' then 'payment_review' end,case when payment_status='expired' then 'link_expired' end,
 case when payment_status<>'paid' and email_status='pending' then 'email_unconfirmed' end,
 case when payment_status<>'paid' and email_status in ('failed','bounced','suppressed','complained') then 'email_'||email_status end,
 case when payment_status<>'paid' and email_status='delayed' then 'email_delayed' end,
 case when payment_status='paid' and receipt_status='pending' then 'receipt_unconfirmed' end,
 case when payment_status='paid' and receipt_status in ('failed','bounced','suppressed','complained','delayed') then 'receipt_'||receipt_status end
 ],null) end as attention_reasons from base;

create or replace function public.portal_staff_filtered(p_search text,p_payment text,p_email text,p_start date,p_end date,p_customer text,p_view text)
returns setof public.portal_staff_links language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if p_search is null or length(p_search)>100 or p_payment is null or p_payment not in ('all','paid','unpaid','processing','review','expired','cancelled','attention') or
  p_email is null or p_email not in ('all','sent','accepted','delivered','bounced','failed','delayed','suppressed','complained','pending','not_requested','unknown') or p_start>p_end or
  p_customer is null or length(p_customer)>300 or p_view is null or p_view not in ('links','customers') then raise exception 'invalid dashboard query'; end if;
 return query select l.* from portal_staff_links l where
  (p_search='' or p_view='customers' or position(lower(p_search) in lower(concat_ws(' ',l.order_number,l.customer_name,l.customer_email)))>0)
  and (p_customer='' or l.customer_key=p_customer)
  and (p_start is null or (l.created_at at time zone 'America/Los_Angeles')::date>=p_start)
  and (p_end is null or (l.created_at at time zone 'America/Los_Angeles')::date<=p_end)
  and (p_payment='all' or p_payment=l.payment_status or p_payment='unpaid' and l.payment_status not in ('paid','cancelled') or p_payment='attention' and cardinality(l.attention_reasons)>0)
  and (p_email='all' or p_email='sent' and case when l.payment_status='paid' then l.receipt_status else l.email_status end in ('accepted','delivered') or p_email=case when l.payment_status='paid' then l.receipt_status else l.email_status end or p_email='unknown' and case when l.payment_status='paid' then l.receipt_status else l.email_status end='pending');
end $$;

create or replace function public.portal_staff_dashboard(p_search text,p_payment text,p_email text,p_offset integer,p_limit integer,p_start date default null,p_end date default null,p_customer text default '',p_view text default 'links')
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare result jsonb;
begin
 if p_offset is null or p_offset not between 0 and 100000 or p_limit is null or p_limit not between 1 and 50 then raise exception 'invalid dashboard page'; end if;
 with filtered as materialized (select * from portal_staff_filtered(p_search,p_payment,p_email,p_start,p_end,p_customer,p_view)),
 customers as materialized (
  select customer_key as key,coalesce((array_agg(customer_name order by created_at desc nulls last,id desc) filter(where nullif(trim(customer_name),'') is not null))[1],max(customer_email),'Unknown customer') as name,
   max(customer_email) as email,count(*) as total,count(*) filter(where payment_status='paid') as paid,count(*) filter(where payment_status not in ('paid','cancelled')) as unpaid,
   count(*) filter(where payment_status='cancelled') as cancelled,coalesce(sum(amount::numeric*100) filter(where payment_status='paid'),0)::bigint as paid_cents,
   coalesce(sum(amount::numeric*100) filter(where payment_status not in ('paid','cancelled')),0)::bigint as unpaid_cents,max(created_at) as last_created_at
  from filtered group by customer_key
 ), matched_customers as materialized (select * from customers where p_search='' or position(lower(p_search) in lower(concat_ws(' ',name,email)))>0),
 page as (select * from filtered order by created_at desc nulls last,id desc limit p_limit offset p_offset),
 customer_page as (select * from matched_customers order by last_created_at desc nulls last,key limit p_limit offset p_offset)
 select jsonb_build_object('summary',(select jsonb_build_object('total',count(*),'paid',count(*) filter(where payment_status='paid'),
   'unpaid',count(*) filter(where payment_status not in ('paid','cancelled')),'cancelled',count(*) filter(where payment_status='cancelled'),
   'paid_cents',coalesce(sum(amount::numeric*100) filter(where payment_status='paid'),0)::bigint,
   'unpaid_cents',coalesce(sum(amount::numeric*100) filter(where payment_status not in ('paid','cancelled')),0)::bigint,
   'sent',count(*) filter(where case when payment_status='paid' then receipt_status else email_status end in ('accepted','delivered')),'attention',count(*) filter(where cardinality(attention_reasons)>0)) from portal_staff_links),
  'total',case when p_view='customers' then (select count(*) from matched_customers) else (select count(*) from filtered) end,'offset',p_offset,'limit',p_limit)
  ||case when p_view='customers' then jsonb_build_object('customers',coalesce((select jsonb_agg(to_jsonb(customer_page) order by last_created_at desc nulls last,key) from customer_page),'[]'::jsonb))
   else jsonb_build_object('links',coalesce((select jsonb_agg(to_jsonb(page) order by created_at desc nulls last,id desc) from page),'[]'::jsonb)) end into result;
 return result;
end $$;

create or replace function public.portal_staff_link(p_id uuid)
returns jsonb language sql security invoker set search_path=public,pg_temp as $$
 select jsonb_build_object('link',to_jsonb(l),'emails',coalesce((select jsonb_agg(to_jsonb(e) order by created_at desc,request_id desc) from
  (select request_id,kind,state,delivery_status,created_at,finished_at,provider_id is not null as can_check from portal_link_emails where payment_link_id=p_id order by created_at desc,request_id desc limit 20) e),'[]'::jsonb))
 from portal_staff_links l where l.id=p_id;
$$;

create or replace function public.portal_staff_export(p_search text,p_payment text,p_email text,p_start date,p_end date,p_customer text)
returns jsonb language sql security invoker set search_path=public,pg_temp as $$
 with filtered as materialized (select * from portal_staff_filtered(p_search,p_payment,p_email,p_start,p_end,p_customer,'links')),
 page as (select id,order_number,customer_name,customer_email,amount,payment_status,email_status,receipt_status,created_at,paid_at,expires_at from filtered order by created_at desc nulls last,id desc limit 10000)
 select case when (select count(*) from filtered)>10000 then jsonb_build_object('code','too_many') else jsonb_build_object('links',coalesce((select jsonb_agg(to_jsonb(page) order by created_at desc nulls last,id desc) from page),'[]'::jsonb)) end;
$$;

revoke all on public.portal_staff_links from public,anon,authenticated;
grant select on public.portal_staff_links to service_role;
revoke all on function public.portal_claim_email(uuid,uuid,text),public.portal_finish_email(uuid,text,uuid),public.portal_record_email_event(text,uuid,uuid,uuid,text,text[],text,timestamptz),public.portal_cancel_link(uuid),public.portal_replace_link(uuid,uuid,text),public.portal_staff_filtered(text,text,text,date,date,text,text),public.portal_staff_export(text,text,text,date,date,text) from public,anon,authenticated;
grant execute on function public.portal_claim_email(uuid,uuid,text),public.portal_finish_email(uuid,text,uuid),public.portal_record_email_event(text,uuid,uuid,uuid,text,text[],text,timestamptz),public.portal_cancel_link(uuid),public.portal_replace_link(uuid,uuid,text),public.portal_staff_filtered(text,text,text,date,date,text,text),public.portal_staff_export(text,text,text,date,date,text) to service_role;
commit;
