begin;

alter table public.payment_links
  add column if not exists request_id uuid,
  add column if not exists payload_hash text,
  add column if not exists expires_at timestamptz default (now() + interval '30 days'),
  add column if not exists cancelled_at timestamptz,
  add column if not exists link_email_sent boolean not null default false,
  add column if not exists receipt_sent boolean not null default false,
  add column if not exists card_last4 text check (card_last4 ~ '^[0-9]{4}$');
alter table public.payment_links enable row level security;
revoke all on public.payment_links from anon, authenticated;
grant select, insert, update on public.payment_links to service_role;
create unique index if not exists payment_links_request_id on public.payment_links(request_id) where request_id is not null;

create table if not exists public.payment_attempts (
  id uuid primary key,
  payment_link_id uuid not null references public.payment_links(id),
  order_id text not null unique check (order_id ~ '^p[0-9a-f]{18}$'),
  amount numeric(12,2) not null check (amount > 0 and amount <= 1000000),
  state text not null check (state in ('processing','unknown','paid','declined','review')),
  retref text,
  card_last4 text check (card_last4 ~ '^[0-9]{4}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists payment_attempts_one_active on public.payment_attempts(payment_link_id)
  where state in ('processing','unknown','review');
alter table public.payment_attempts enable row level security;
revoke all on public.payment_attempts from public, anon, authenticated;
grant select, insert, update on public.payment_attempts to service_role;

create table if not exists public.portal_rate_buckets (
  key text not null,
  bucket bigint not null,
  count integer not null,
  expires_at timestamptz not null,
  primary key (key,bucket)
);
create index if not exists portal_rate_buckets_expiry on public.portal_rate_buckets(expires_at);
alter table public.portal_rate_buckets enable row level security;
revoke all on public.portal_rate_buckets from public, anon, authenticated;

create or replace function public.portal_rate_limit(p_key text, p_limit integer, p_window integer)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer; b bigint;
begin
  if p_limit < 1 or p_window < 1 or length(p_key) > 200 then raise exception 'invalid rate request'; end if;
  b := floor(extract(epoch from now()) / p_window);
  insert into portal_rate_buckets(key,bucket,count,expires_at) values(p_key,b,1,to_timestamp((b+1)*p_window))
    on conflict(key,bucket) do update set count = portal_rate_buckets.count + 1 returning count into n;
  -- Old buckets are safe to remove; they contain salted digests, never raw IPs.
  delete from portal_rate_buckets where expires_at < now() - interval '1 day';
  return n <= p_limit;
end $$;

create or replace function public.portal_claim_payment(p_link_id uuid, p_attempt_id uuid, p_order_id text, p_amount numeric)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare l payment_links; a payment_attempts;
begin
  select * into l from payment_links where id = p_link_id for update;
  if not found then return jsonb_build_object('code','unavailable'); end if;
  if l.status = 'paid' then return jsonb_build_object('code','paid','retref',l.retref,'paid_at',l.paid_at); end if;
  if l.status <> 'pending' or l.cancelled_at is not null or l.expires_at is null or l.expires_at <= now() then
    return jsonb_build_object('code','unavailable');
  end if;
  if l.amount <= 0 or l.amount > 1000000 or round(l.amount::numeric,2) <> l.amount or p_amount <> l.amount then
    return jsonb_build_object('code','invalid_amount');
  end if;
  select * into a from payment_attempts where payment_link_id = p_link_id and state in ('processing','unknown','review');
  if found then return jsonb_build_object('code','pending','attempt',to_jsonb(a)); end if;
  insert into payment_attempts(id,payment_link_id,order_id,amount,state)
    values(p_attempt_id,p_link_id,p_order_id,l.amount,'processing') returning * into a;
  return jsonb_build_object('code','claimed','attempt',to_jsonb(a));
end $$;

create or replace function public.portal_finish_payment(p_attempt_id uuid, p_state text, p_retref text default null, p_last4 text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare a payment_attempts; l payment_links;
begin
  if p_last4 is not null and p_last4 !~ '^[0-9]{4}$' then raise exception 'invalid masked card'; end if;
  if p_state not in ('unknown','paid','declined','review') then raise exception 'invalid outcome'; end if;
  select * into a from payment_attempts where id = p_attempt_id;
  if not found then raise exception 'missing attempt'; end if;
  select * into l from payment_links where id = a.payment_link_id for update;
  select * into a from payment_attempts where id = p_attempt_id for update;
  if a.state in ('paid','declined') then return jsonb_build_object('state',a.state,'retref',a.retref); end if;
  if p_state = 'paid' and (p_retref is null or p_retref !~ '^[0-9]{12}$' or a.amount <> l.amount) then raise exception 'invalid approval'; end if;
  if p_state = 'paid' and l.status <> 'pending' then raise exception 'invoice not pending'; end if;
  update payment_attempts set state=p_state, retref=coalesce(p_retref,retref), card_last4=coalesce(p_last4,card_last4), updated_at=now() where id=a.id;
  if p_state = 'paid' then
    update payment_links set status='paid', paid_at=now(), retref=p_retref, card_last4=coalesce(p_last4,a.card_last4) where id=l.id;
  end if;
  return jsonb_build_object('state',p_state,'retref',p_retref);
end $$;

create or replace function public.portal_create_link(p_request_id uuid, p_hash text, p_order_number text,
  p_amount numeric, p_customer_name text, p_customer_email text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare l payment_links;
begin
  if p_amount <= 0 or p_amount > 1000000 or round(p_amount,2) <> p_amount or
    length(p_order_number) not between 1 and 200 or length(p_customer_name) not between 1 and 400 or
    length(p_customer_email) not between 3 and 254 or p_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid link'; end if;
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

revoke all on function public.portal_rate_limit(text,integer,integer) from public, anon, authenticated;
revoke all on function public.portal_claim_payment(uuid,uuid,text,numeric) from public, anon, authenticated;
revoke all on function public.portal_finish_payment(uuid,text,text,text) from public, anon, authenticated;
revoke all on function public.portal_create_link(uuid,text,text,numeric,text,text) from public, anon, authenticated;
grant execute on function public.portal_rate_limit(text,integer,integer) to service_role;
grant execute on function public.portal_claim_payment(uuid,uuid,text,numeric) to service_role;
grant execute on function public.portal_finish_payment(uuid,text,text,text) to service_role;
grant execute on function public.portal_create_link(uuid,text,text,numeric,text,text) to service_role;

commit;
