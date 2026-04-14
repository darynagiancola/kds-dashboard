-- reset_kds_seed_orders.sql
-- TEST-ONLY reset script for repeatable KDS live-mode testing.
--
-- Safety principles:
-- - does NOT disable triggers or RLS globally
-- - does NOT weaken production transition rules
-- - targets only explicit seeded IDs and test-tagged notes
-- - re-runnable (idempotent)

begin;

create extension if not exists pgcrypto;

-- Optional audit context for event tracing in order_events.
select set_config('kds.audit_source', 'system', true);
select set_config('kds.correlation_id', 'kds-test-reset', true);

-- Fixed seed actor used only for test data.
-- Keep this stable so repeated runs are deterministic.
with seed_constants as (
  select
    '11111111-1111-4111-8111-111111111111'::uuid as seed_user_id
)
insert into auth.users (
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
select
  seed_user_id,
  'authenticated',
  'authenticated',
  'kds.seed.waiter@example.com',
  crypt('seed-password', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"KDS Seed Waiter","role":"waiter"}'::jsonb,
  now(),
  now()
from seed_constants
on conflict (id) do update
set
  email = excluded.email,
  updated_at = now();

with seed_constants as (
  select
    '11111111-1111-4111-8111-111111111111'::uuid as seed_user_id
)
insert into public.profiles (id, full_name, role, is_active)
select
  seed_user_id,
  'KDS Seed Waiter',
  'waiter',
  true
from seed_constants
on conflict (id) do update
set
  full_name = excluded.full_name,
  role = excluded.role,
  is_active = excluded.is_active,
  updated_at = now();

-- Remove only prior seeded/test orders.
-- Child rows are removed automatically via ON DELETE CASCADE.
delete from public.orders
where id in (
  '20000000-0000-4000-8000-000000000001'::uuid,
  '20000000-0000-4000-8000-000000000002'::uuid,
  '20000000-0000-4000-8000-000000000003'::uuid
)
or note like '[KDS_TEST]%';

-- Reinsert baseline test orders in each active board status.
insert into public.orders (
  id,
  table_number,
  status,
  priority,
  created_by,
  note,
  created_at,
  updated_at
)
values
  (
    '20000000-0000-4000-8000-000000000001'::uuid,
    12,
    'new',
    'rush',
    '11111111-1111-4111-8111-111111111111'::uuid,
    '[KDS_TEST] Allergy note: no peanuts',
    now() - interval '4 minutes',
    now() - interval '4 minutes'
  ),
  (
    '20000000-0000-4000-8000-000000000002'::uuid,
    5,
    'in_progress',
    'high',
    '11111111-1111-4111-8111-111111111111'::uuid,
    '[KDS_TEST] Fire mains first',
    now() - interval '12 minutes',
    now() - interval '10 minutes'
  ),
  (
    '20000000-0000-4000-8000-000000000003'::uuid,
    9,
    'ready',
    'normal',
    '11111111-1111-4111-8111-111111111111'::uuid,
    '[KDS_TEST] Ready for pickup',
    now() - interval '18 minutes',
    now() - interval '3 minutes'
  );

insert into public.order_items (
  id,
  order_id,
  name,
  quantity,
  notes,
  created_at,
  updated_at
)
values
  ('30000000-0000-4000-8000-000000000001'::uuid, '20000000-0000-4000-8000-000000000001'::uuid, 'Smash Burger', 1, null, now() - interval '4 minutes', now() - interval '4 minutes'),
  ('30000000-0000-4000-8000-000000000002'::uuid, '20000000-0000-4000-8000-000000000001'::uuid, 'Fries', 1, null, now() - interval '4 minutes', now() - interval '4 minutes'),
  ('30000000-0000-4000-8000-000000000003'::uuid, '20000000-0000-4000-8000-000000000002'::uuid, 'Chicken Caesar Salad', 1, null, now() - interval '12 minutes', now() - interval '10 minutes'),
  ('30000000-0000-4000-8000-000000000004'::uuid, '20000000-0000-4000-8000-000000000002'::uuid, 'Tomato Soup', 1, null, now() - interval '12 minutes', now() - interval '10 minutes'),
  ('30000000-0000-4000-8000-000000000005'::uuid, '20000000-0000-4000-8000-000000000003'::uuid, 'Ribeye Steak', 1, null, now() - interval '18 minutes', now() - interval '3 minutes'),
  ('30000000-0000-4000-8000-000000000006'::uuid, '20000000-0000-4000-8000-000000000003'::uuid, 'Mashed Potatoes', 1, null, now() - interval '18 minutes', now() - interval '3 minutes');

insert into public.order_item_modifiers (id, order_item_id, text, created_at)
values
  ('40000000-0000-4000-8000-000000000001'::uuid, '30000000-0000-4000-8000-000000000001'::uuid, 'well done', now() - interval '4 minutes'),
  ('40000000-0000-4000-8000-000000000002'::uuid, '30000000-0000-4000-8000-000000000001'::uuid, 'no onion', now() - interval '4 minutes'),
  ('40000000-0000-4000-8000-000000000003'::uuid, '30000000-0000-4000-8000-000000000002'::uuid, 'extra crispy', now() - interval '4 minutes'),
  ('40000000-0000-4000-8000-000000000004'::uuid, '30000000-0000-4000-8000-000000000003'::uuid, 'dressing on side', now() - interval '12 minutes'),
  ('40000000-0000-4000-8000-000000000005'::uuid, '30000000-0000-4000-8000-000000000004'::uuid, 'extra hot', now() - interval '12 minutes'),
  ('40000000-0000-4000-8000-000000000006'::uuid, '30000000-0000-4000-8000-000000000005'::uuid, 'medium rare', now() - interval '18 minutes'),
  ('40000000-0000-4000-8000-000000000007'::uuid, '30000000-0000-4000-8000-000000000005'::uuid, 'sauce on side', now() - interval '18 minutes');

commit;

-- Optional quick verification:
-- select status, count(*) from public.orders where note like '[KDS_TEST]%' group by status order by status;
