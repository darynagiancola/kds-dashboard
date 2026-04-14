create or replace function public.log_order_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.order_status_history (
      order_id,
      from_status,
      to_status,
      changed_by,
      station_id,
      reason,
      changed_at
    )
    values (
      new.id,
      null,
      new.status,
      new.created_by,
      new.station_id,
      'order_created',
      coalesce(new.created_at, now())
    );
    return new;
  end if;

  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    insert into public.order_status_history (
      order_id,
      from_status,
      to_status,
      changed_by,
      station_id,
      changed_at
    )
    values (
      new.id,
      old.status,
      new.status,
      auth.uid(),
      new.station_id,
      now()
    );
  end if;

  return new;
end;
$$;

create or replace function public.guard_order_mutations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.app_role;
begin
  select p.role
  into v_role
  from public.profiles p
  where p.id = auth.uid();

  if v_role = 'admin' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if v_role = 'waiter' then
      if new.created_by <> auth.uid() then
        raise exception 'waiter can only create own orders';
      end if;
      if new.status <> 'new' then
        raise exception 'waiter can only create orders in new status';
      end if;
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if v_role = 'waiter' then
      if old.created_by <> auth.uid() then
        raise exception 'waiter can only edit own orders';
      end if;
      if old.status <> 'new' then
        raise exception 'waiter can only edit orders while status is new';
      end if;
      if new.status is distinct from old.status then
        raise exception 'waiter cannot change order status';
      end if;
      if new.station_id is distinct from old.station_id then
        raise exception 'waiter cannot change station assignment';
      end if;
      if new.created_by is distinct from old.created_by then
        raise exception 'waiter cannot change order ownership';
      end if;
    end if;

    if v_role = 'kitchen' then
      if new.status is not distinct from old.status then
        raise exception 'kitchen update must change status';
      end if;

      if new.table_number is distinct from old.table_number
        or new.created_by is distinct from old.created_by
        or new.station_id is distinct from old.station_id
        or new.priority is distinct from old.priority
        or new.note is distinct from old.note
        or new.target_ready_at is distinct from old.target_ready_at
        or new.order_number is distinct from old.order_number
        or new.created_at is distinct from old.created_at then
        raise exception 'kitchen can only update status';
      end if;

      if not (
        (old.status = 'new' and new.status = 'in_progress')
        or (old.status = 'in_progress' and new.status = 'ready')
        or (old.status = 'ready' and new.status = 'delivered')
      ) then
        raise exception 'invalid status transition: % -> %', old.status, new.status;
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_orders_log_status_change on public.orders;
create trigger trg_orders_log_status_change
after insert or update of status on public.orders
for each row execute function public.log_order_status_change();

drop trigger if exists trg_guard_order_mutations on public.orders;
create trigger trg_guard_order_mutations
before insert or update on public.orders
for each row execute function public.guard_order_mutations();
