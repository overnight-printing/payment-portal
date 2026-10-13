begin;

create table if not exists public.portal_link_emails (
  request_id uuid primary key,
  payment_link_id uuid not null references public.payment_links(id),
  state text not null check (state in ('pending','accepted','failed')) default 'pending',
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create unique index if not exists portal_link_emails_one_pending on public.portal_link_emails(payment_link_id) where state='pending';
create index if not exists portal_link_emails_history on public.portal_link_emails(payment_link_id,created_at desc,request_id desc);
alter table public.portal_link_emails enable row level security;
revoke all on public.portal_link_emails from public,anon,authenticated;
grant select on public.portal_link_emails to service_role;

create or replace view public.portal_staff_links with (security_invoker=true) as
select l.id,l.order_number,l.customer_name,l.customer_email,round(l.amount::numeric,2)::text as amount,l.created_at,l.paid_at,l.expires_at,
  case when nullif(trim(l.customer_email),'') is not null then 'email:'||lower(trim(l.customer_email)) else 'link:'||l.id::text end as customer_key,
  case when l.status='paid' then 'paid' when a.state='review' then 'review'
    when a.state in ('processing','unknown') then 'processing' when l.cancelled_at is not null then 'cancelled'
    when l.expires_at is null or l.expires_at<=now() then 'expired' else 'unpaid' end as payment_status,
  coalesce(e.state,case when l.link_email_status='unknown' and l.link_email_sent then 'accepted' else l.link_email_status end) as email_status,
  coalesce(e.finished_at,e.created_at) as last_email_at
from public.payment_links l
left join public.payment_attempts a on a.payment_link_id=l.id and a.state in ('processing','unknown','review')
left join lateral (select state,created_at,finished_at from public.portal_link_emails where payment_link_id=l.id order by created_at desc,request_id desc limit 1) e on true;
revoke all on public.portal_staff_links from public,anon,authenticated;
grant select on public.portal_staff_links to service_role;

drop function if exists public.portal_staff_dashboard(text,text,text,integer,integer);
create or replace function public.portal_staff_dashboard(p_search text,p_payment text,p_email text,p_offset integer,p_limit integer,
  p_start date default null,p_end date default null,p_customer text default '',p_view text default 'links')
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare result jsonb;
begin
  if p_search is null or length(p_search)>100 or p_payment is null or p_payment not in ('all','paid','unpaid','processing','review','expired','cancelled','attention') or
    p_email is null or p_email not in ('all','accepted','not_requested','failed','unknown') or
    p_offset is null or p_offset not between 0 and 100000 or p_limit is null or p_limit not between 1 and 50 or
    p_start>p_end or p_customer is null or length(p_customer)>300 or p_view is null or p_view not in ('links','customers') then raise exception 'invalid dashboard query'; end if;
  with base as materialized (select *,payment_status<>'paid' and (payment_status in ('review','processing','expired') or email_status in ('failed','pending')) as attention from public.portal_staff_links),
  filtered as materialized (
    select * from base where (p_search='' or p_view='customers' or position(lower(p_search) in lower(concat_ws(' ',order_number,customer_name,customer_email)))>0)
      and (p_customer='' or customer_key=p_customer)
      and (p_start is null or (created_at at time zone 'America/Los_Angeles')::date>=p_start)
      and (p_end is null or (created_at at time zone 'America/Los_Angeles')::date<=p_end)
      and (p_payment='all' or p_payment=payment_status or p_payment='unpaid' and payment_status<>'paid' or p_payment='attention' and attention)
      and (p_email='all' or p_email=email_status or p_email='unknown' and email_status='pending')
  ), customers as materialized (
    select customer_key as key,
      coalesce((array_agg(customer_name order by created_at desc nulls last,id desc) filter(where nullif(trim(customer_name),'') is not null))[1],max(customer_email),'Unknown customer') as name,
      max(customer_email) as email,count(*) as total,count(*) filter(where payment_status='paid') as paid,count(*) filter(where payment_status<>'paid') as unpaid,
      coalesce(sum(amount::numeric*100) filter(where payment_status='paid'),0)::bigint as paid_cents,
      coalesce(sum(amount::numeric*100) filter(where payment_status<>'paid'),0)::bigint as unpaid_cents,max(created_at) as last_created_at
    from filtered group by customer_key
  ), matched_customers as materialized (
    select * from customers where p_search='' or position(lower(p_search) in lower(concat_ws(' ',name,email)))>0
  ), page as (
    select id,order_number,customer_name,customer_email,customer_key,amount,created_at,paid_at,expires_at,payment_status,email_status,last_email_at
    from filtered order by created_at desc nulls last,id desc limit p_limit offset p_offset
  ), customer_page as (
    select * from matched_customers order by last_created_at desc nulls last,key limit p_limit offset p_offset
  )
  select jsonb_build_object(
    'summary',(select jsonb_build_object('total',count(*),'paid',count(*) filter(where payment_status='paid'),'unpaid',count(*) filter(where payment_status<>'paid'),
      'paid_cents',coalesce(sum(amount::numeric*100) filter(where payment_status='paid'),0)::bigint,
      'unpaid_cents',coalesce(sum(amount::numeric*100) filter(where payment_status<>'paid'),0)::bigint,
      'sent',count(*) filter(where email_status='accepted'),'attention',count(*) filter(where attention)) from base),
    'total',case when p_view='customers' then (select count(*) from matched_customers) else (select count(*) from filtered) end,
    'offset',p_offset,'limit',p_limit
  )||case when p_view='customers' then jsonb_build_object('customers',coalesce((select jsonb_agg(to_jsonb(customer_page) order by last_created_at desc nulls last,key) from customer_page),'[]'::jsonb))
    else jsonb_build_object('links',coalesce((select jsonb_agg(to_jsonb(page) order by created_at desc nulls last,id desc) from page),'[]'::jsonb)) end into result;
  return result;
end $$;

create or replace function public.portal_staff_link(p_id uuid)
returns jsonb language sql security invoker set search_path=public,pg_temp as $$
  select jsonb_build_object('link',to_jsonb(l),'emails',coalesce((select jsonb_agg(to_jsonb(e) order by created_at desc,request_id desc)
    from (select request_id,state,created_at,finished_at from public.portal_link_emails where payment_link_id=p_id order by created_at desc,request_id desc limit 20) e),'[]'::jsonb))
  from public.portal_staff_links l where l.id=p_id;
$$;

create or replace function public.portal_claim_link_email(p_request_id uuid,p_link_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare l public.payment_links; e public.portal_link_emails;
begin
  if p_request_id is null or p_link_id is null then raise exception 'invalid email request'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,1));
  select * into l from public.payment_links where id=p_link_id for update;
  if not found then return jsonb_build_object('code','unavailable'); end if;
  select * into e from public.portal_link_emails where request_id=p_request_id;
  if found then
    if e.payment_link_id<>p_link_id then return jsonb_build_object('code','conflict'); end if;
    return jsonb_build_object('code','existing','state',e.state);
  end if;
  if l.status is distinct from 'pending' or l.cancelled_at is not null or l.expires_at is null or l.expires_at<=now() or
    exists(select 1 from public.payment_attempts where payment_link_id=p_link_id and state in ('processing','unknown','review')) then return jsonb_build_object('code','unavailable'); end if;
  if exists(select 1 from public.portal_link_emails where payment_link_id=p_link_id and state='pending') or l.link_email_status='pending' then return jsonb_build_object('code','pending','state','pending'); end if;
  insert into public.portal_link_emails(request_id,payment_link_id) values(p_request_id,p_link_id);
  update public.payment_links set link_email_status='pending' where id=p_link_id;
  return jsonb_build_object('code','claimed','state','pending');
end $$;

create or replace function public.portal_finish_link_email(p_request_id uuid,p_state text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.portal_link_emails;
begin
  if p_state is null or p_state not in ('pending','accepted','failed') then raise exception 'invalid email outcome'; end if;
  select * into e from public.portal_link_emails where request_id=p_request_id;
  if not found then raise exception 'missing email request'; end if;
  perform 1 from public.payment_links where id=e.payment_link_id for update;
  select * into e from public.portal_link_emails where request_id=p_request_id for update;
  if e.state<>'pending' then return jsonb_build_object('state',e.state); end if;
  update public.portal_link_emails set state=p_state,finished_at=case when p_state='pending' then null else now() end where request_id=p_request_id;
  update public.payment_links set link_email_status=p_state,link_email_sent=link_email_sent or p_state='accepted' where id=e.payment_link_id;
  return jsonb_build_object('state',p_state);
end $$;

revoke all on function public.portal_staff_dashboard(text,text,text,integer,integer,date,date,text,text) from public,anon,authenticated;
revoke all on function public.portal_staff_link(uuid) from public,anon,authenticated;
revoke all on function public.portal_claim_link_email(uuid,uuid) from public,anon,authenticated;
revoke all on function public.portal_finish_link_email(uuid,text) from public,anon,authenticated;
grant execute on function public.portal_staff_dashboard(text,text,text,integer,integer,date,date,text,text) to service_role;
grant execute on function public.portal_staff_link(uuid) to service_role;
grant execute on function public.portal_claim_link_email(uuid,uuid) to service_role;
grant execute on function public.portal_finish_link_email(uuid,text) to service_role;
commit;
