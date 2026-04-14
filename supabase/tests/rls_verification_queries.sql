-- RLS verification script for KDS schema.
-- Run after all migrations and after creating at least three users/profiles:
--   waiter user, kitchen user, admin user.
--
-- Replace placeholders below before running:
--   :WAITER_ID
--   :KITCHEN_ID
--   :ADMIN_ID
--
-- In Supabase SQL editor, you can emulate users with:
--   select set_config('request.jwt.claim.sub', '<uuid>', true);
--
-- NOTE: set_config auth emulation can vary by environment. If unavailable,
-- test with direct API calls authenticated as each role.

-- ------------------------------------------------------
-- 0) Seed baseline stations and profile roles
-- ------------------------------------------------------

insert into public.kitchen_stations (code, name, sort_order)
values
  ('GRILL', 'Grill', 1),
  ('SAUTE', 'Saute', 2),
  ('EXPO', 'Expo', 3)
on conflict (code) do nothing;

update public.profiles set role = 'waiter' where id = :'WAITER_ID';
update public.profiles set role = 'kitchen' where id = :'KITCHEN_ID';
update public.profiles set role = 'admin' where id = :'ADMIN_ID';

-- ------------------------------------------------------
-- 1) WAITER tests
-- ------------------------------------------------------

-- emulate waiter
select set_config('request.jwt.claim.sub', :'WAITER_ID', true);

-- waiter can create own order in new status
insert into public.orders (table_number, status, priority, created_by, note)
values (11, 'new', 'high', :'WAITER_ID', 'No peanuts')
returning id, order_number, status;

-- waiter should fail if created_by differs
-- expect: ERROR
insert into public.orders (table_number, status, priority, created_by)
values (12, 'new', 'normal', :'KITCHEN_ID');

-- waiter should fail if status != new on insert
-- expect: ERROR
insert into public.orders (table_number, status, priority, created_by)
values (13, 'ready', 'normal', :'WAITER_ID');

-- waiter can view only own orders
select id, created_by, status from public.orders order by created_at desc limit 20;

-- add item/modifier on own "new" order
with latest_order as (
  select id
  from public.orders
  where created_by = :'WAITER_ID'
  order by created_at desc
  limit 1
),
inserted_item as (
  insert into public.order_items (order_id, name, quantity, notes)
  select id, 'Burger', 2, 'Well done'
  from latest_order
  returning id, order_id
)
insert into public.order_item_modifiers (order_item_id, text)
select id, 'No onion'
from inserted_item;

-- waiter cannot change status (kitchen-only)
-- expect: ERROR
update public.orders
set status = 'in_progress'
where id = (
  select id from public.orders where created_by = :'WAITER_ID' order by created_at desc limit 1
);

-- ------------------------------------------------------
-- 2) KITCHEN tests
-- ------------------------------------------------------

select set_config('request.jwt.claim.sub', :'KITCHEN_ID', true);

-- kitchen can read active orders
select id, status, table_number
from public.orders
where status in ('new', 'in_progress', 'ready')
order by created_at desc;

-- kitchen can transition new -> in_progress on active order
update public.orders
set status = 'in_progress'
where id = (
  select id
  from public.orders
  where status = 'new'
  order by created_at asc
  limit 1
)
returning id, status;

-- kitchen cannot modify non-status fields
-- expect: ERROR
update public.orders
set table_number = 99
where id = (
  select id
  from public.orders
  where status in ('new', 'in_progress', 'ready')
  order by created_at asc
  limit 1
);

-- kitchen can continue in_progress -> ready
update public.orders
set status = 'ready'
where id = (
  select id
  from public.orders
  where status = 'in_progress'
  order by created_at asc
  limit 1
)
returning id, status;

-- kitchen can do ready -> delivered
update public.orders
set status = 'delivered'
where id = (
  select id
  from public.orders
  where status = 'ready'
  order by created_at asc
  limit 1
)
returning id, status;

-- kitchen should fail invalid transition (delivered -> new)
-- expect: ERROR
update public.orders
set status = 'new'
where id = (
  select id
  from public.orders
  where status = 'delivered'
  order by created_at desc
  limit 1
);

-- ------------------------------------------------------
-- 3) ADMIN tests
-- ------------------------------------------------------

select set_config('request.jwt.claim.sub', :'ADMIN_ID', true);

-- admin full read
select count(*) as all_orders from public.orders;
select count(*) as all_items from public.order_items;
select count(*) as all_modifiers from public.order_item_modifiers;
select count(*) as all_status_events from public.order_status_history;
select count(*) as all_audit_events from public.audit_logs;

-- admin can edit any fields
update public.orders
set note = 'Updated by admin'
where id = (select id from public.orders order by created_at desc limit 1)
returning id, note;

-- ------------------------------------------------------
-- 4) Verify history + audit generated automatically
-- ------------------------------------------------------

select id, order_id, from_status, to_status, changed_by, changed_at
from public.order_status_history
order by id desc
limit 20;

select id, table_name, action, row_pk, changed_by, changed_columns, changed_at
from public.audit_logs
order by id desc
limit 30;
