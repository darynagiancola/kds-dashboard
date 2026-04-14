-- Allow KDS dashboard read-only access with anon key (no waiter login flow).
-- This keeps write paths protected and only exposes active board data.

alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_item_modifiers enable row level security;

drop policy if exists orders_anon_kds_select_active on public.orders;
create policy orders_anon_kds_select_active
on public.orders
for select
to anon
using (status in ('new', 'in_progress', 'ready'));

drop policy if exists order_items_anon_kds_select_active on public.order_items;
create policy order_items_anon_kds_select_active
on public.order_items
for select
to anon
using (
  exists (
    select 1
    from public.orders o
    where o.id = order_items.order_id
      and o.status in ('new', 'in_progress', 'ready')
  )
);

drop policy if exists modifiers_anon_kds_select_active on public.order_item_modifiers;
create policy modifiers_anon_kds_select_active
on public.order_item_modifiers
for select
to anon
using (
  exists (
    select 1
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where oi.id = order_item_modifiers.order_item_id
      and o.status in ('new', 'in_progress', 'ready')
  )
);
