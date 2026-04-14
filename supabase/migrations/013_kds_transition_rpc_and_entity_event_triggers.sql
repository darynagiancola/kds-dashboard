-- 013_kds_transition_rpc_and_entity_event_triggers.sql
-- Adds RPC transition wrapper with correlation context and item/modifier event hooks.

begin;

create or replace function public.kds_transition_order_status(
  p_order_id uuid,
  p_to_status public.order_status,
  p_source public.audit_source default 'user',
  p_request_id uuid default null,
  p_correlation_id text default null
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
begin
  perform set_config('kds.audit_source', p_source::text, true);

  if p_request_id is not null then
    perform set_config('kds.request_id', p_request_id::text, true);
  end if;

  if p_correlation_id is not null then
    perform set_config('kds.correlation_id', p_correlation_id, true);
  end if;

  update public.orders
  set status = p_to_status
  where id = p_order_id
  returning * into v_order;

  if not found then
    raise exception 'Order not found or blocked by policy';
  end if;

  return v_order;
end;
$$;

grant execute on function public.kds_transition_order_status(uuid, public.order_status, public.audit_source, uuid, text) to anon, authenticated;

create or replace function public.kds_order_items_event_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.kds_log_order_event(
      'order_item',
      new.id,
      new.order_id,
      'item_created',
      null,
      to_jsonb(new),
      true,
      null,
      null,
      (select o.version from public.orders o where o.id = new.order_id)
    );
    return new;
  elsif tg_op = 'UPDATE' then
    perform public.kds_log_order_event(
      'order_item',
      new.id,
      new.order_id,
      'item_updated',
      to_jsonb(old),
      to_jsonb(new),
      true,
      null,
      null,
      (select o.version from public.orders o where o.id = new.order_id)
    );
    return new;
  elsif tg_op = 'DELETE' then
    perform public.kds_log_order_event(
      'order_item',
      old.id,
      old.order_id,
      'item_deleted',
      to_jsonb(old),
      null,
      true,
      null,
      null,
      (select o.version from public.orders o where o.id = old.order_id)
    );
    return old;
  end if;

  return null;
end;
$$;

drop trigger if exists trg_order_items_event_audit on public.order_items;
create trigger trg_order_items_event_audit
after insert or update or delete on public.order_items
for each row execute function public.kds_order_items_event_trigger();

create or replace function public.kds_order_item_modifiers_event_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
begin
  if tg_op = 'INSERT' then
    select oi.order_id into v_order_id
    from public.order_items oi
    where oi.id = new.order_item_id;

    perform public.kds_log_order_event(
      'order_item_modifier',
      new.id,
      v_order_id,
      'modifier_created',
      null,
      to_jsonb(new),
      true,
      null,
      null,
      (select o.version from public.orders o where o.id = v_order_id)
    );
    return new;
  elsif tg_op = 'UPDATE' then
    select oi.order_id into v_order_id
    from public.order_items oi
    where oi.id = new.order_item_id;

    perform public.kds_log_order_event(
      'order_item_modifier',
      new.id,
      v_order_id,
      'modifier_updated',
      to_jsonb(old),
      to_jsonb(new),
      true,
      null,
      null,
      (select o.version from public.orders o where o.id = v_order_id)
    );
    return new;
  elsif tg_op = 'DELETE' then
    select oi.order_id into v_order_id
    from public.order_items oi
    where oi.id = old.order_item_id;

    perform public.kds_log_order_event(
      'order_item_modifier',
      old.id,
      v_order_id,
      'modifier_deleted',
      to_jsonb(old),
      null,
      true,
      null,
      null,
      (select o.version from public.orders o where o.id = v_order_id)
    );
    return old;
  end if;

  return null;
end;
$$;

drop trigger if exists trg_order_item_modifiers_event_audit on public.order_item_modifiers;
create trigger trg_order_item_modifiers_event_audit
after insert or update or delete on public.order_item_modifiers
for each row execute function public.kds_order_item_modifiers_event_trigger();

commit;
