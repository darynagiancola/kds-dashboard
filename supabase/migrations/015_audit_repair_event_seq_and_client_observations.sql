-- 015_audit_repair_event_seq_and_client_observations.sql
-- Safe repair migration for partially applied 012/013/014.
-- - Adds and backfills public.order_events.event_seq if missing
-- - Creates/repairs public.kds_client_observations if missing/partial
-- - Idempotent and safe to re-run

begin;

create extension if not exists pgcrypto;

-- -------------------------------------------------------------------
-- Repair order_events.event_seq
-- -------------------------------------------------------------------
do $$
declare
  has_order_events boolean;
  has_event_seq boolean;
  max_event_seq bigint;
begin
  select to_regclass('public.order_events') is not null into has_order_events;

  if has_order_events then
    select exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'order_events'
        and column_name = 'event_seq'
    ) into has_event_seq;

    if not has_event_seq then
      alter table public.order_events
        add column event_seq bigint;
    end if;

    create sequence if not exists public.order_events_event_seq_seq;

    alter sequence public.order_events_event_seq_seq
      owned by public.order_events.event_seq;

    alter table public.order_events
      alter column event_seq set default nextval('public.order_events_event_seq_seq'::regclass);

    update public.order_events
    set event_seq = nextval('public.order_events_event_seq_seq'::regclass)
    where event_seq is null;

    select max(event_seq) into max_event_seq from public.order_events;
    if max_event_seq is null then
      perform setval('public.order_events_event_seq_seq', 1, false);
    else
      perform setval('public.order_events_event_seq_seq', max_event_seq, true);
    end if;

    alter table public.order_events
      alter column event_seq set not null;

    create unique index if not exists idx_order_events_event_seq_unique
      on public.order_events(event_seq);
  end if;
end $$;

-- -------------------------------------------------------------------
-- Create/repair kds_client_observations
-- -------------------------------------------------------------------
create table if not exists public.kds_client_observations (
  id bigint generated always as identity primary key,
  client_id text not null,
  order_id uuid not null references public.orders(id) on delete cascade,
  observed_status public.order_status not null,
  observed_version bigint not null,
  correlation_id text,
  observed_at timestamptz not null default now()
);

alter table public.kds_client_observations
  add column if not exists id bigint generated always as identity,
  add column if not exists client_id text,
  add column if not exists order_id uuid,
  add column if not exists observed_status public.order_status,
  add column if not exists observed_version bigint,
  add column if not exists correlation_id text,
  add column if not exists observed_at timestamptz default now();

alter table public.kds_client_observations
  alter column client_id set not null,
  alter column order_id set not null,
  alter column observed_status set not null,
  alter column observed_version set not null,
  alter column observed_at set default now(),
  alter column observed_at set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'kds_client_observations_pkey'
      and conrelid = 'public.kds_client_observations'::regclass
  ) then
    alter table public.kds_client_observations
      add constraint kds_client_observations_pkey primary key (id);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'kds_client_observations_order_id_fkey'
      and conrelid = 'public.kds_client_observations'::regclass
  ) then
    alter table public.kds_client_observations
      add constraint kds_client_observations_order_id_fkey
      foreign key (order_id)
      references public.orders(id)
      on delete cascade;
  end if;
end $$;

create index if not exists idx_kds_client_observations_client_time
  on public.kds_client_observations(client_id, observed_at desc);

create index if not exists idx_kds_client_observations_order_time
  on public.kds_client_observations(order_id, observed_at desc);

select pg_notify('pgrst', 'reload schema');

commit;
