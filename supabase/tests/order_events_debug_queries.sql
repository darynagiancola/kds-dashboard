-- order_events_debug_queries.sql
-- Practical production debugging queries for KDS incidents.

-- NOTE:
-- Replace placeholder values before running:
--   $ORDER_ID, $REQUEST_ID, $CORRELATION_ID

-- 1) Why did this order disappear?
-- replace $ORDER_ID with a concrete uuid literal
select
  id,
  event_type,
  previous_state ->> 'status' as from_status,
  new_state ->> 'status' as to_status,
  source,
  actor_id,
  request_id,
  correlation_id,
  expected,
  error_code,
  error_message,
  entity_version,
  created_at
from public.order_events
where order_id = $ORDER_ID
order by id desc;

-- 2) Who changed status?
select
  created_at,
  actor_id,
  source,
  previous_state ->> 'status' as from_status,
  new_state ->> 'status' as to_status,
  request_id,
  correlation_id,
  entity_version
from public.order_events
where order_id = $ORDER_ID
  and event_type = 'status_changed'
order by id;

-- 3) Last 5 minutes anomalies/errors
select
  id,
  order_id,
  event_type,
  expected,
  error_code,
  error_message,
  source,
  request_id,
  correlation_id,
  created_at
from public.order_events
where created_at >= now() - interval '5 minutes'
  and expected = false
order by id desc;

-- 4) Out-of-order or version gaps for status events
with status_events as (
  select
    order_id,
    id,
    entity_version,
    lag(entity_version) over (partition by order_id order by entity_version, id) as prev_version
  from public.order_events
  where event_type in ('created', 'status_changed')
)
select *
from status_events
where prev_version is not null
  and entity_version <> prev_version + 1
order by id desc;

-- 5) Recent events stream
select
  id,
  order_id,
  event_type,
  source,
  actor_id,
  entity_version,
  created_at
from public.order_events
order by id desc
limit 200;

-- 6) Duplicate transition attempts by same request_id (idempotency issues)
select
  order_id,
  request_id,
  event_type,
  count(*) as duplicate_count,
  min(created_at) as first_seen_at,
  max(created_at) as last_seen_at
from public.order_events
where request_id is not null
  and event_type = 'status_changed'
group by order_id, request_id, event_type
having count(*) > 1
order by last_seen_at desc;

-- 7) Find transition anomalies quickly
select
  id,
  order_id,
  event_type,
  error_code,
  error_message,
  previous_state ->> 'status' as from_status,
  new_state ->> 'status' as to_status,
  source,
  actor_id,
  request_id,
  correlation_id,
  created_at
from public.order_events
where event_type in (
  'anomaly_invalid_transition',
  'anomaly_duplicate_status_update',
  'anomaly_duplicate_request_id'
)
order by id desc
limit 200;

-- 8) Correlation trace: everything in one operation path
select
  id,
  order_id,
  entity_type,
  entity_id,
  event_type,
  source,
  actor_id,
  request_id,
  correlation_id,
  entity_version,
  created_at
from public.order_events
where correlation_id = $CORRELATION_ID
order by id;

-- 9) Why do two clients disagree? (if client observations are used)
-- Requires inserts into public.kds_client_observations from clients.
select
  o.id as order_id,
  o.status as db_status,
  o.version as db_version,
  c.client_id,
  c.observed_status,
  c.observed_version,
  c.observed_at,
  c.correlation_id
from public.orders o
join lateral (
  select *
  from public.kds_client_observations c
  where c.order_id = o.id
  order by c.observed_at desc
  limit 5
) c on true
where c.observed_version < o.version
order by c.observed_at desc;
