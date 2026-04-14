-- Standardize modifiers relationship naming for Supabase embeds:
-- order_items(..., order_item_modifiers(...))
-- Keeps legacy public.modifiers data by copying into public.order_item_modifiers.

begin;

create extension if not exists pgcrypto;

do $$
declare
  order_item_id_type text;
  has_order_item_modifiers boolean;
begin
  select format_type(a.atttypid, a.atttypmod)
    into order_item_id_type
  from pg_attribute a
  where a.attrelid = 'public.order_items'::regclass
    and a.attname = 'id'
    and a.attnum > 0
    and not a.attisdropped;

  if order_item_id_type is null then
    raise exception 'public.order_items.id not found';
  end if;

  select exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'order_item_modifiers'
  ) into has_order_item_modifiers;

  if not has_order_item_modifiers then
    if order_item_id_type = 'uuid' then
      execute $sql$
        create table public.order_item_modifiers (
          id uuid primary key default gen_random_uuid(),
          order_item_id uuid not null,
          text text not null,
          created_at timestamptz not null default now()
        )
      $sql$;
    else
      execute $sql$
        create table public.order_item_modifiers (
          id bigint generated always as identity primary key,
          order_item_id bigint not null,
          text text not null,
          created_at timestamptz not null default now()
        )
      $sql$;
    end if;
  end if;
end $$;

-- Copy legacy data if the old modifiers table exists.
do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'modifiers'
  ) then
    insert into public.order_item_modifiers (order_item_id, text, created_at)
    select m.order_item_id, m.text, coalesce(m.created_at, now())
    from public.modifiers m
    where not exists (
      select 1
      from public.order_item_modifiers om
      where om.order_item_id = m.order_item_id
        and om.text = m.text
    );
  end if;
end $$;

-- Align constraints/indexes for clear relational embeds.
alter table public.order_item_modifiers
  alter column order_item_id set not null,
  alter column text set not null;

alter table public.order_item_modifiers
  drop constraint if exists order_item_modifiers_order_item_id_fkey;

alter table public.order_item_modifiers
  add constraint order_item_modifiers_order_item_id_fkey
  foreign key (order_item_id)
  references public.order_items(id)
  on delete cascade;

create index if not exists idx_order_item_modifiers_order_item_id
  on public.order_item_modifiers(order_item_id);

create index if not exists idx_order_item_modifiers_text_trgm
  on public.order_item_modifiers using gin (text gin_trgm_ops);

-- Ensure realtime includes canonical table.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'order_item_modifiers'
  ) then
    alter publication supabase_realtime add table public.order_item_modifiers;
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
