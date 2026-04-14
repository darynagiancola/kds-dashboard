-- order_events_debug_queries.sql
-- Practical production debugging queries for KDS incidents.

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
