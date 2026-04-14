-- reset_kds_seed_orders.sql
-- TEST-ONLY reseed strategy (insert-only).
--
-- Guarantees:
-- - never updates old orders backward
-- - never deletes existing orders
-- - each run inserts a fresh KDS_TEST batch with new UUIDs
-- - preserves production triggers, transition rules, and audit logging

begin;

create extension if not exists pgcrypto;

-- Stable seed actor for created_by references in test data.
with seed_constants as (
  select '11111111-1111-4111-8111-111111111111'::uuid as seed_user_id
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
set updated_at = now();

with seed_constants as (
  select '11111111-1111-4111-8111-111111111111'::uuid as seed_user_id
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

with
run_context as (
  select
    now() as run_at,
    left(replace(gen_random_uuid()::text, '-', ''), 12) as batch_tag
),
order_blueprint as (
  select *
  from (
    values
      (1, 12, 'new'::public.order_status, 'rush'::public.order_priority, 'Allergy note: no peanuts', interval '4 minutes'),
      (2, 5, 'in_progress'::public.order_status, 'high'::public.order_priority, 'Fire mains first', interval '12 minutes'),
      (3, 9, 'ready'::public.order_status, 'normal'::public.order_priority, 'Ready for pickup', interval '18 minutes')
  ) as v(slot_no, table_number, status, priority, note_suffix, age_offset)
),
inserted_orders as (
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
  select
    gen_random_uuid(),
    ob.table_number,
    ob.status,
    ob.priority,
    '11111111-1111-4111-8111-111111111111'::uuid,
    format(
      '[KDS_TEST][batch:%s][slot:%s] %s',
      rc.batch_tag,
      ob.slot_no,
      ob.note_suffix
    ),
    rc.run_at - ob.age_offset,
    rc.run_at - ob.age_offset
  from order_blueprint ob
  cross join run_context rc
  returning id, note
),
order_map as (
  select
    io.id as order_id,
    substring(io.note from '\[slot:([0-9]+)\]')::integer as slot_no
  from inserted_orders io
),
item_blueprint as (
  select *
  from (
    values
      (1, 'o1i1', 'Smash Burger', 1, null::text, interval '4 minutes'),
      (1, 'o1i2', 'Fries', 1, null::text, interval '4 minutes'),
      (2, 'o2i1', 'Chicken Caesar Salad', 1, null::text, interval '12 minutes'),
      (2, 'o2i2', 'Tomato Soup', 1, null::text, interval '12 minutes'),
      (3, 'o3i1', 'Ribeye Steak', 1, null::text, interval '18 minutes'),
      (3, 'o3i2', 'Mashed Potatoes', 1, null::text, interval '18 minutes')
  ) as v(slot_no, item_key, name, quantity, notes, age_offset)
),
inserted_items as (
  insert into public.order_items (
    id,
    order_id,
    name,
    quantity,
    notes,
    created_at,
    updated_at
  )
  select
    gen_random_uuid(),
    om.order_id,
    ib.name,
    ib.quantity,
    ib.notes,
    rc.run_at - ib.age_offset,
    rc.run_at - ib.age_offset
  from item_blueprint ib
  join order_map om on om.slot_no = ib.slot_no
  cross join run_context rc
  returning id, order_id, name, quantity, notes
),
item_map as (
  select
    ii.id as order_item_id,
    ib.item_key
  from inserted_items ii
  join order_map om on om.order_id = ii.order_id
  join item_blueprint ib
    on ib.slot_no = om.slot_no
   and ib.name = ii.name
   and ib.quantity = ii.quantity
   and coalesce(ib.notes, '') = coalesce(ii.notes, '')
),
modifier_blueprint as (
  select *
  from (
    values
      ('o1i1', 'well done', interval '4 minutes'),
      ('o1i1', 'no onion', interval '4 minutes'),
      ('o1i2', 'extra crispy', interval '4 minutes'),
      ('o2i1', 'dressing on side', interval '12 minutes'),
      ('o2i2', 'extra hot', interval '12 minutes'),
      ('o3i1', 'medium rare', interval '18 minutes'),
      ('o3i1', 'sauce on side', interval '18 minutes')
  ) as v(item_key, text, age_offset)
),
inserted_modifiers as (
  insert into public.order_item_modifiers (
    id,
    order_item_id,
    text,
    created_at
  )
  select
    gen_random_uuid(),
    im.order_item_id,
    mb.text,
    rc.run_at - mb.age_offset
  from modifier_blueprint mb
  join item_map im on im.item_key = mb.item_key
  cross join run_context rc
  returning id
)
select
  rc.batch_tag as inserted_batch_tag,
  (select count(*) from inserted_orders) as orders_inserted,
  (select count(*) from inserted_items) as order_items_inserted,
  (select count(*) from inserted_modifiers) as modifiers_inserted
from run_context rc;

commit;

-- Optional quick verification:
-- select status, count(*) from public.orders where note like '[KDS_TEST]%' and status in ('new', 'in_progress', 'ready') group by status order by status;
