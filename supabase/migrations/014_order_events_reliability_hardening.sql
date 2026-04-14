-- 014_order_events_reliability_hardening.sql
-- Tightens production diagnostics for out-of-order/delayed/duplicate analysis
-- and state reconstruction without replacing prior 012/013 migrations.

begin;

create extension if not exists pgcrypto;

create or replace function public.kds_jsonb_diff(old_row jsonb, new_row jsonb)
returns jsonb
language sql
stable
as $$
  select coalesce(
    jsonb_object_agg(key_name, jsonb_build_object('from', old_val, 'to', new_val)),
    '{}'::jsonb
  )
  from (
    select
      coalesce(o.key, n.key) as key_name,
      o.value as old_val,
      n.value as new_val
    from jsonb_each(coalesce(old_row, '{}'::jsonb)) o
    full outer join jsonb_each(coalesce(new_row, '{}'::jsonb)) n
      on o.key = n.key
  ) diff
  where old_val is distinct from new_val;
$$;

alter table public.order_events
  add column if not exists state_diff jsonb,
  add column if not exists event_class text not null default 'business';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'order_events_event_class_check'
      and conrelid = 'public.order_events'::regclass
  ) then
    alter table public.order_events
      add constraint order_events_event_class_check
      check (event_class in ('business', 'technical', 'anomaly', 'realtime'));
  end if;
end $$;

update public.order_events
set state_diff = public.kds_jsonb_diff(previous_state, new_state)
where state_diff is null;

update public.order_events
set event_class = case
  when event_type like 'anomaly_%' then 'anomaly'
  when expected = false then 'technical'
  when source::text = 'realtime' then 'realtime'
  else 'business'
end
where event_class is null
   or event_class = '';

create index if not exists idx_order_events_order_version_id
  on public.order_events(order_id, entity_version, id);

create unique index if not exists uq_order_events_request_dedupe
  on public.order_events(order_id, event_type, request_id)
  where request_id is not null and expected = true;

create table if not exists public.kds_client_event_receipts (
  id bigint generated always as identity primary key,
  client_id text not null,
  order_id uuid not null references public.orders(id) on delete cascade,
  seen_order_version bigint not null,
  seen_event_id bigint references public.order_events(id) on delete set null,
  receipt_source public.audit_source not null default 'realtime',
  lag_ms integer,
  is_stale boolean not null default false,
  correlation_id text,
  received_at timestamptz not null default now()
);

create index if not exists idx_kds_receipts_client_time
  on public.kds_client_event_receipts(client_id, received_at desc);

create index if not exists idx_kds_receipts_order_version
  on public.kds_client_event_receipts(order_id, seen_order_version desc, received_at desc);

create or replace function public.kds_reconstruct_order_state(p_order_id uuid)
returns table (
  order_id uuid,
  last_event_id bigint,
  last_event_at timestamptz,
  reconstructed_version bigint,
  reconstructed_state jsonb
)
language sql
stable
as $$
  with latest_event as (
    select
      e.order_id,
      e.id as last_event_id,
      e.created_at as last_event_at,
      e.entity_version as reconstructed_version,
      e.new_state as reconstructed_state
    from public.order_events e
    where e.order_id = p_order_id
      and e.entity_type = 'order'
      and e.new_state is not null
    order by e.entity_version desc nulls last, e.id desc
    limit 1
  )
  select
    l.order_id,
    l.last_event_id,
    l.last_event_at,
    l.reconstructed_version,
    l.reconstructed_state
  from latest_event l;
$$;

create or replace function public.kds_log_order_event(
  p_entity_type text,
  p_entity_id uuid,
  p_order_id uuid,
  p_event_type text,
  p_previous_state jsonb default null,
  p_new_state jsonb default null,
  p_expected boolean default true,
  p_error_code text default null,
  p_error_message text default null,
  p_entity_version bigint default null,
  p_event_class text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source public.audit_source := public.kds_current_audit_source();
  v_event_class text;
begin
  v_event_class := coalesce(
    p_event_class,
    case
      when p_event_type like 'anomaly_%' then 'anomaly'
      when not p_expected then 'technical'
      when v_source = 'realtime' then 'realtime'
      else 'business'
    end
  );

  insert into public.order_events (
    entity_type,
    entity_id,
    order_id,
    event_type,
    previous_state,
    new_state,
    state_diff,
    source,
    actor_id,
    request_id,
    correlation_id,
    expected,
    error_code,
    error_message,
    entity_version,
    event_class
  )
  values (
    p_entity_type,
    p_entity_id,
    p_order_id,
    p_event_type,
    p_previous_state,
    p_new_state,
    public.kds_jsonb_diff(p_previous_state, p_new_state),
    v_source,
    auth.uid(),
    public.kds_current_request_id(),
    public.kds_current_correlation_id(),
    p_expected,
    p_error_code,
    p_error_message,
    p_entity_version,
    v_event_class
  );
end;
$$;

commit;
