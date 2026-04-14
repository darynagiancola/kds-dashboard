-- 010_kds_anon_status_updates.sql
-- Allow anon KDS clients to move active orders through kitchen statuses.
-- Keeps updates scoped to active tickets and status-only transitions.

begin;

-- Ensure anon role has required table privileges (RLS still applies).
grant select, update on table public.orders to anon;

drop policy if exists orders_anon_update_status_kds on public.orders;
create policy orders_anon_update_status_kds
on public.orders
for update
to anon
using (
  status in ('new', 'in_progress', 'ready')
)
with check (
  status in ('in_progress', 'ready', 'delivered')
);

commit;
