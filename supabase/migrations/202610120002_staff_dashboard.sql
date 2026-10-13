begin;

alter table public.payment_links
  add column if not exists link_email_status text not null default 'unknown'
    check (link_email_status in ('unknown','not_requested','pending','accepted','failed'));
-- Historical false means no reliable send history, not a failed or unrequested email.
update public.payment_links set link_email_status='accepted' where link_email_sent=true and link_email_status<>'accepted';
create index if not exists payment_links_created_order on public.payment_links(created_at desc nulls last, id desc);

create or replace function public.portal_staff_dashboard(p_search text, p_payment text, p_email text, p_offset integer, p_limit integer)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare result jsonb;
begin
  if p_search is null or length(p_search)>100 or p_payment is null or p_payment not in ('all','paid','unpaid','processing','review','expired','cancelled') or
    p_email is null or p_email not in ('all','accepted','not_requested','failed','unknown') or
    p_offset is null or p_offset not between 0 and 100000 or p_limit is null or p_limit not between 1 and 50 then
    raise exception 'invalid dashboard query';
  end if;
  with base as materialized (
    select l.id,l.order_number,l.customer_name,l.customer_email,l.amount,l.created_at,l.paid_at,
      case when l.status='paid' then 'paid'
        when a.state='review' then 'review' when a.state in ('processing','unknown') then 'processing'
        when l.cancelled_at is not null then 'cancelled'
        when l.expires_at is null or l.expires_at<=now() then 'expired' else 'unpaid' end as payment_status,
      case when l.link_email_sent then 'accepted' else l.link_email_status end as email_status
    from public.payment_links l
    left join public.payment_attempts a on a.payment_link_id=l.id and a.state in ('processing','unknown','review')
  ), filtered as materialized (
    select * from base where (p_search='' or position(lower(p_search) in lower(concat_ws(' ',order_number,customer_name,customer_email)))>0)
      and (p_payment='all' or p_payment=payment_status or p_payment='unpaid' and payment_status<>'paid')
      and (p_email='all' or p_email=email_status or p_email='unknown' and email_status='pending')
  ), page as (
    select id,order_number,customer_name,customer_email,round(amount::numeric,2)::text as amount,created_at,paid_at,payment_status,email_status
    from filtered order by created_at desc nulls last,id desc limit p_limit offset p_offset
  )
  select jsonb_build_object(
    'summary',(select jsonb_build_object('total',count(*),'paid',count(*) filter(where payment_status='paid'),
      'unpaid',count(*) filter(where payment_status<>'paid'),
      'paid_cents',coalesce(sum(amount*100) filter(where payment_status='paid'),0)::bigint,
      'unpaid_cents',coalesce(sum(amount*100) filter(where payment_status<>'paid'),0)::bigint) from base),
    'total',(select count(*) from filtered),'offset',p_offset,'limit',p_limit,
    'links',coalesce((select jsonb_agg(to_jsonb(page) order by created_at desc nulls last,id desc) from page),'[]'::jsonb)
  ) into result;
  return result;
end $$;

revoke all on function public.portal_staff_dashboard(text,text,text,integer,integer) from public, anon, authenticated;
grant execute on function public.portal_staff_dashboard(text,text,text,integer,integer) to service_role;

commit;
