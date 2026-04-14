-- archive_old_kds_test_batches.sql
-- TEST-ONLY optional cleanup for historical KDS test batches.
--
-- Goal:
-- - keep the latest N KDS test batches visible on the board
-- - move older KDS test batches forward to delivered (legal transitions only)
-- - avoid deleting orders, so audit/FK behavior remains intact
--
-- Safe with strict trigger/audit setups because it:
-- - performs only forward status transitions (new -> in_progress -> ready -> delivered)
-- - never deletes from public.orders
-- - only touches rows explicitly tagged with [KDS_TEST][batch:...]

begin;

-- Build cleanup target set once for this transaction.
create temp table kds_test_archive_targets on commit drop as
with config as (
  -- Change keep_latest_batches if you want to retain more than one active test batch.
  select 1::integer as keep_latest_batches
),
ranked_batches as (
  select
    substring(o.note from '\[batch:([0-9a-f]+)\]') as batch_tag,
    row_number() over (
      order by max(o.created_at) desc, substring(o.note from '\[batch:([0-9a-f]+)\]')
    ) as recency_rank
  from public.orders o
  where o.note like '[KDS_TEST][batch:%'
  group by substring(o.note from '\[batch:([0-9a-f]+)\]')
),
batches_to_archive as (
  select rb.batch_tag
  from ranked_batches rb
  cross join config c
  where rb.recency_rank > c.keep_latest_batches
)
select o.id
from public.orders o
join batches_to_archive b
  on substring(o.note from '\[batch:([0-9a-f]+)\]') = b.batch_tag
where o.note like '[KDS_TEST][batch:%';

update public.orders o
set status = 'in_progress'
where o.id in (select id from kds_test_archive_targets)
  and o.status = 'new';

update public.orders o
set status = 'ready'
where o.id in (select id from kds_test_archive_targets)
  and o.status = 'in_progress';

update public.orders o
set status = 'delivered'
where o.id in (select id from kds_test_archive_targets)
  and o.status = 'ready';

update public.orders o
set note = regexp_replace(o.note, '^\[KDS_TEST\]', '[KDS_TEST_ARCHIVED]'),
    updated_at = now()
where o.id in (select id from kds_test_archive_targets)
  and o.note like '[KDS_TEST][batch:%';

commit;

-- Optional verification:
-- select status, count(*) from public.orders where note like '[KDS_TEST]%' group by status order by status;
-- select status, count(*) from public.orders where note like '[KDS_TEST_ARCHIVED]%' group by status order by status;
