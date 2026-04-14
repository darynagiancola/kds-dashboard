-- 016_fix_kds_log_order_event_ambiguity.sql
-- Resolves function overload ambiguity for public.kds_log_order_event(...)
-- by keeping a single canonical signature used by existing triggers/RPC paths.

begin;

create extension if not exists pgcrypto;

-- Ensure helper exists (idempotent safeguard).
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

-- Drop the 11-arg overload (added in 014) to remove ambiguous resolution.
drop function if exists public.kds_log_order_event(
  text,
  uuid,
  uuid,
  text,
  jsonb,
  jsonb,
  boolean,
  text,
  text,
  bigint,
  text
);

-- Recreate/normalize the canonical 10-arg signature only.
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
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source public.audit_source := public.kds_current_audit_source();
  v_event_class text;
begin
  v_event_class := case
    when p_event_type like 'anomaly_%' then 'anomaly'
    when not p_expected then 'technical'
    when v_source = 'realtime' then 'realtime'
    else 'business'
  end;

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

-- Keep grants explicit for environments that manage function privileges tightly.
grant execute on function public.kds_log_order_event(
  text,
  uuid,
  uuid,
  text,
  jsonb,
  jsonb,
  boolean,
  text,
  text,
  bigint
) to anon, authenticated;

-- Refresh PostgREST schema cache.
notify pgrst, 'reload schema';

commit;
