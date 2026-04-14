-- 011_kds_delivered_visibility_for_updates.sql
-- Prevent "violates row-level security policy for table orders" on final status moves.
-- PostgREST update flows may need read visibility on the updated row. If select
-- policies exclude delivered rows, ready -> delivered updates can fail.

begin;

-- Keep anon KDS board read access aligned with transition lifecycle, including delivered.
drop policy if exists orders_anon_read_active_kds on public.orders;
create policy orders_anon_read_active_kds
on public.orders
for select
to anon
using (status in ('new', 'in_progress', 'ready', 'delivered'));

-- Keep kitchen reads consistent with transition lifecycle as well.
drop policy if exists orders_kitchen_select_active on public.orders;
create policy orders_kitchen_select_active
on public.orders
for select
to authenticated
using (
  public.current_app_role() = 'kitchen'
  and status in ('new', 'in_progress', 'ready', 'delivered')
);

commit;
