-- 005_rls_and_policies.sql
-- Enables RLS and applies waiter/kitchen/admin authorization policies.

alter table public.profiles enable row level security;
alter table public.kitchen_stations enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_item_modifiers enable row level security;
alter table public.order_status_history enable row level security;
alter table public.audit_logs enable row level security;

alter table public.profiles force row level security;
alter table public.kitchen_stations force row level security;
alter table public.orders force row level security;
alter table public.order_items force row level security;
alter table public.order_item_modifiers force row level security;
alter table public.order_status_history force row level security;
alter table public.audit_logs force row level security;

-- Drop existing policies for repeatable migration runs.
drop policy if exists profiles_select_self_or_admin on public.profiles;
drop policy if exists profiles_update_self_or_admin on public.profiles;
drop policy if exists profiles_admin_insert on public.profiles;
drop policy if exists profiles_admin_delete on public.profiles;

drop policy if exists stations_read_all_authenticated on public.kitchen_stations;
drop policy if exists stations_admin_full on public.kitchen_stations;

drop policy if exists orders_admin_all on public.orders;
drop policy if exists orders_waiter_insert on public.orders;
drop policy if exists orders_waiter_select_own on public.orders;
drop policy if exists orders_waiter_update_own on public.orders;
drop policy if exists orders_kitchen_select_active on public.orders;
drop policy if exists orders_kitchen_update_status on public.orders;

drop policy if exists items_admin_all on public.order_items;
drop policy if exists items_waiter_select_own on public.order_items;
drop policy if exists items_waiter_insert_own_new_orders on public.order_items;
drop policy if exists items_waiter_update_own_new_orders on public.order_items;
drop policy if exists items_waiter_delete_own_new_orders on public.order_items;
drop policy if exists items_kitchen_select_active on public.order_items;

drop policy if exists modifiers_admin_all on public.order_item_modifiers;
drop policy if exists modifiers_waiter_select_own on public.order_item_modifiers;
drop policy if exists modifiers_waiter_insert_own_new_orders on public.order_item_modifiers;
drop policy if exists modifiers_waiter_update_own_new_orders on public.order_item_modifiers;
drop policy if exists modifiers_waiter_delete_own_new_orders on public.order_item_modifiers;
drop policy if exists modifiers_kitchen_select_active on public.order_item_modifiers;

drop policy if exists status_history_admin_all on public.order_status_history;
drop policy if exists status_history_waiter_select_own on public.order_status_history;
drop policy if exists status_history_kitchen_select_active on public.order_status_history;

drop policy if exists audit_logs_admin_all on public.audit_logs;

-- Profiles
create policy profiles_select_self_or_admin
on public.profiles
for select
to authenticated
using (id = auth.uid() or public.is_admin());

create policy profiles_update_self_or_admin
on public.profiles
for update
to authenticated
using (id = auth.uid() or public.is_admin())
with check (
  public.is_admin()
  or (
    id = auth.uid()
    and role = (
      select p.role
      from public.profiles p
      where p.id = auth.uid()
    )
  )
);

create policy profiles_admin_insert
on public.profiles
for insert
to authenticated
with check (public.is_admin());

create policy profiles_admin_delete
on public.profiles
for delete
to authenticated
using (public.is_admin());

-- Kitchen stations
create policy stations_read_all_authenticated
on public.kitchen_stations
for select
to authenticated
using (true);

create policy stations_admin_full
on public.kitchen_stations
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Orders
create policy orders_admin_all
on public.orders
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy orders_waiter_insert
on public.orders
for insert
to authenticated
with check (
  public.current_app_role() = 'waiter'
  and created_by = auth.uid()
  and status = 'new'
);

create policy orders_waiter_select_own
on public.orders
for select
to authenticated
using (
  public.current_app_role() = 'waiter'
  and created_by = auth.uid()
);

create policy orders_waiter_update_own
on public.orders
for update
to authenticated
using (
  public.current_app_role() = 'waiter'
  and created_by = auth.uid()
)
with check (
  public.current_app_role() = 'waiter'
  and created_by = auth.uid()
);

create policy orders_kitchen_select_active
on public.orders
for select
to authenticated
using (
  public.current_app_role() = 'kitchen'
  and status in ('new', 'in_progress', 'ready')
);

create policy orders_kitchen_update_status
on public.orders
for update
to authenticated
using (
  public.current_app_role() = 'kitchen'
  and status in ('new', 'in_progress', 'ready')
)
with check (
  public.current_app_role() = 'kitchen'
);

-- Order items
create policy items_admin_all
on public.order_items
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy items_waiter_select_own
on public.order_items
for select
to authenticated
using (
  public.current_app_role() = 'waiter'
  and exists (
    select 1
    from public.orders o
    where o.id = order_items.order_id
      and o.created_by = auth.uid()
  )
);

create policy items_waiter_insert_own_new_orders
on public.order_items
for insert
to authenticated
with check (
  public.current_app_role() = 'waiter'
  and exists (
    select 1
    from public.orders o
    where o.id = order_items.order_id
      and o.created_by = auth.uid()
      and o.status = 'new'
  )
);

create policy items_waiter_update_own_new_orders
on public.order_items
for update
to authenticated
using (
  public.current_app_role() = 'waiter'
  and exists (
    select 1
    from public.orders o
    where o.id = order_items.order_id
      and o.created_by = auth.uid()
      and o.status = 'new'
  )
)
with check (
  public.current_app_role() = 'waiter'
  and exists (
    select 1
    from public.orders o
    where o.id = order_items.order_id
      and o.created_by = auth.uid()
      and o.status = 'new'
  )
);

create policy items_waiter_delete_own_new_orders
on public.order_items
for delete
to authenticated
using (
  public.current_app_role() = 'waiter'
  and exists (
    select 1
    from public.orders o
    where o.id = order_items.order_id
      and o.created_by = auth.uid()
      and o.status = 'new'
  )
);

create policy items_kitchen_select_active
on public.order_items
for select
to authenticated
using (
  public.current_app_role() = 'kitchen'
  and exists (
    select 1
    from public.orders o
    where o.id = order_items.order_id
      and o.status in ('new', 'in_progress', 'ready')
  )
);

-- Modifiers
create policy modifiers_admin_all
on public.order_item_modifiers
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy modifiers_waiter_select_own
on public.order_item_modifiers
for select
to authenticated
using (
  public.current_app_role() = 'waiter'
  and exists (
    select 1
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where oi.id = order_item_modifiers.order_item_id
      and o.created_by = auth.uid()
  )
);

create policy modifiers_waiter_insert_own_new_orders
on public.order_item_modifiers
for insert
to authenticated
with check (
  public.current_app_role() = 'waiter'
  and exists (
    select 1
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where oi.id = order_item_modifiers.order_item_id
      and o.created_by = auth.uid()
      and o.status = 'new'
  )
);

create policy modifiers_waiter_update_own_new_orders
on public.order_item_modifiers
for update
to authenticated
using (
  public.current_app_role() = 'waiter'
  and exists (
    select 1
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where oi.id = order_item_modifiers.order_item_id
      and o.created_by = auth.uid()
      and o.status = 'new'
  )
)
with check (
  public.current_app_role() = 'waiter'
  and exists (
    select 1
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where oi.id = order_item_modifiers.order_item_id
      and o.created_by = auth.uid()
      and o.status = 'new'
  )
);

create policy modifiers_waiter_delete_own_new_orders
on public.order_item_modifiers
for delete
to authenticated
using (
  public.current_app_role() = 'waiter'
  and exists (
    select 1
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where oi.id = order_item_modifiers.order_item_id
      and o.created_by = auth.uid()
      and o.status = 'new'
  )
);

create policy modifiers_kitchen_select_active
on public.order_item_modifiers
for select
to authenticated
using (
  public.current_app_role() = 'kitchen'
  and exists (
    select 1
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where oi.id = order_item_modifiers.order_item_id
      and o.status in ('new', 'in_progress', 'ready')
  )
);

-- Status history
create policy status_history_admin_all
on public.order_status_history
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy status_history_waiter_select_own
on public.order_status_history
for select
to authenticated
using (
  public.current_app_role() = 'waiter'
  and exists (
    select 1
    from public.orders o
    where o.id = order_status_history.order_id
      and o.created_by = auth.uid()
  )
);

create policy status_history_kitchen_select_active
on public.order_status_history
for select
to authenticated
using (
  public.current_app_role() = 'kitchen'
  and exists (
    select 1
    from public.orders o
    where o.id = order_status_history.order_id
      and o.status in ('new', 'in_progress', 'ready')
  )
);

-- Audit logs (admin only)
create policy audit_logs_admin_all
on public.audit_logs
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());
