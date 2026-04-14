-- 012_order_events_auditability.sql
-- Production-oriented structured audit events for KDS order lifecycle.

begin;

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'audit_source') then
    create type public.audit_source as enum ('user', 'system', 'realtime');
  end if;
end $$;

alter table public.orders
  add column if not exists version bigint not null default 1;

create table if not exists public.order_events (
  id bigint generated always as identity primary key,
  entity_type text not null check (entity_type in ('order', 'order_item', 'order_item_modifier')),
  entity_id uuid not null,
  order_id uuid not null references public.orders(id) on delete cascade,
  event_type text not null,
  previous_state jsonb,
  new_state jsonb,
  source public.audit_source not null default 'system',
  actor_id uuid references public.profiles(id) on delete set null,
  request_id uuid,
  correlation_id text,
  expected boolean not null default true,
  error_code text,
  error_message text,
  entity_version bigint,
  db_txid bigint not null default txid_current(),
  created_at timestamptz not null default now()
);

create index if not exists idx_order_events_order_id_id_desc
  on public.order_events(order_id, id desc);

create index if not exists idx_order_events_entity
  on public.order_events(entity_type, entity_id, id desc);

create index if not exists idx_order_events_event_type_time
  on public.order_events(event_type, created_at desc);

create index if not exists idx_order_events_expected_time
  on public.order_events(expected, created_at desc);

create index if not exists idx_order_events_request_id
  on public.order_events(request_id);

create index if not exists idx_order_events_correlation_id
  on public.order_events(correlation_id);

create or replace function public.kds_current_audit_source()
returns public.audit_source
language plpgsql
stable
as $$
declare
  v text;
begin
  v := nullif(current_setting('kds.audit_source', true), '');
  if v in ('user', 'system', 'realtime') then
    return v::public.audit_source;
  end if;
  return 'system'::public.audit_source;
end;
$$;

create or replace function public.kds_current_request_id()
returns uuid
language plpgsql
stable
as $$
declare
  v text;
begin
  v := nullif(current_setting('kds.request_id', true), '');
  if v is null then
    return null;
  end if;
  begin
    return v::uuid;
  exception when others then
    return null;
  end;
end;
$$;

create or replace function public.kds_current_correlation_id()
returns text
language sql
stable
as $$
  select nullif(current_setting('kds.correlation_id', true), '');
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
  p_entity_version bigint default null
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.order_events (
    entity_type,
    entity_id,
    order_id,
    event_type,
    previous_state,
    new_state,
    source,
    actor_id,
    request_id,
    correlation_id,
    expected,
    error_code,
    error_message,
    entity_version
  )
  values (
    p_entity_type,
    p_entity_id,
    p_order_id,
    p_event_type,
    p_previous_state,
    p_new_state,
    public.kds_current_audit_source(),
    auth.uid(),
    public.kds_current_request_id(),
    public.kds_current_correlation_id(),
    p_expected,
    p_error_code,
    p_error_message,
    p_entity_version
  );
$$;

create or replace function public.kds_orders_bump_version()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    new.version := old.version + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_01_orders_bump_version on public.orders;
create trigger trg_01_orders_bump_version
before update on public.orders
for each row execute function public.kds_orders_bump_version();

create or replace function public.kds_orders_anomaly_checks()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is not distinct from old.status then
    perform public.kds_log_order_event(
      'order',
      old.id,
      old.id,
      'anomaly_duplicate_status_update',
      jsonb_build_object('status', old.status, 'version', old.version),
      jsonb_build_object('status', new.status, 'version', old.version),
      false,
      'DUPLICATE_STATUS',
      'Status update attempted with same status value',
      old.version
    );
    return new;
  end if;

  if not (
    (old.status = 'new' and new.status = 'in_progress')
    or (old.status = 'in_progress' and new.status = 'ready')
    or (old.status = 'ready' and new.status = 'delivered')
  ) then
    perform public.kds_log_order_event(
      'order',
      old.id,
      old.id,
      'anomaly_invalid_transition',
      jsonb_build_object('status', old.status, 'version', old.version),
      jsonb_build_object('status', new.status, 'version', old.version + 1),
      false,
      'INVALID_TRANSITION',
      format('Invalid transition: %s -> %s', old.status, new.status),
      old.version + 1
    );
    raise exception 'Invalid order status transition: % -> %', old.status, new.status;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_00_orders_anomaly_checks on public.orders;
create trigger trg_00_orders_anomaly_checks
before update of status on public.orders
for each row execute function public.kds_orders_anomaly_checks();

create or replace function public.kds_orders_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.kds_log_order_event(
      'order',
      new.id,
      new.id,
      'created',
      null,
      to_jsonb(new),
      true,
      null,
      null,
      new.version
    );
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.status is distinct from old.status then
      perform public.kds_log_order_event(
        'order',
        new.id,
        new.id,
        'status_changed',
        to_jsonb(old),
        to_jsonb(new),
        true,
        null,
        null,
        new.version
      );
    else
      perform public.kds_log_order_event(
        'order',
        new.id,
        new.id,
        'updated',
        to_jsonb(old),
        to_jsonb(new),
        true,
        null,
        null,
        new.version
      );
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    perform public.kds_log_order_event(
      'order',
      old.id,
      old.id,
      'deleted',
      to_jsonb(old),
      null,
      true,
      null,
      null,
      old.version
    );
    return old;
  end if;

  return null;
end;
$$;

drop trigger if exists trg_20_orders_audit_events on public.orders;
create trigger trg_20_orders_audit_events
after insert or update or delete on public.orders
for each row execute function public.kds_orders_audit_trigger();

alter table public.order_events enable row level security;

drop policy if exists order_events_admin_all on public.order_events;
create policy order_events_admin_all
on public.order_events
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists order_events_read_scoped on public.order_events;
create policy order_events_read_scoped
on public.order_events
for select
to authenticated
using (
  public.is_admin()
  or public.current_app_role() = 'kitchen'
  or exists (
    select 1
    from public.orders o
    where o.id = order_events.order_id
      and o.created_by = auth.uid()
  )
);

commit;
