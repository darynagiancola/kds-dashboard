alter table if exists public.audit_logs disable row level security;

create table if not exists public.audit_logs (
  id bigserial primary key,
  table_name text not null,
  row_pk text not null,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  changed_by uuid references public.profiles(id) on delete set null,
  changed_at timestamptz not null default now(),
  old_data jsonb,
  new_data jsonb,
  changed_columns text[] not null default '{}'::text[]
);

create index if not exists idx_audit_logs_table_row_changed_at
  on public.audit_logs(table_name, row_pk, changed_at desc);

create index if not exists idx_audit_logs_changed_by_changed_at
  on public.audit_logs(changed_by, changed_at desc);

create index if not exists idx_audit_logs_changed_at
  on public.audit_logs(changed_at desc);

create index if not exists idx_audit_logs_old_data_gin
  on public.audit_logs using gin (old_data);

create index if not exists idx_audit_logs_new_data_gin
  on public.audit_logs using gin (new_data);

create or replace function public.audit_row_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_pk text;
  v_cols text[];
begin
  if tg_op = 'INSERT' then
    v_new := to_jsonb(new) - 'updated_at';
    v_pk := coalesce(v_new ->> 'id', '');
    select coalesce(array_agg(key), '{}'::text[]) into v_cols
    from jsonb_object_keys(v_new) as key;

    insert into public.audit_logs(table_name, row_pk, action, changed_by, old_data, new_data, changed_columns)
    values (tg_table_name, v_pk, 'INSERT', auth.uid(), null, v_new, v_cols);

    return new;
  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old) - 'updated_at';
    v_new := to_jsonb(new) - 'updated_at';
    v_pk := coalesce(v_new ->> 'id', v_old ->> 'id', '');

    select coalesce(array_agg(key), '{}'::text[]) into v_cols
    from (
      select coalesce(o.key, n.key) as key, o.value as old_v, n.value as new_v
      from jsonb_each(v_old) o
      full outer join jsonb_each(v_new) n on o.key = n.key
    ) d
    where old_v is distinct from new_v;

    if coalesce(array_length(v_cols, 1), 0) > 0 then
      insert into public.audit_logs(table_name, row_pk, action, changed_by, old_data, new_data, changed_columns)
      values (tg_table_name, v_pk, 'UPDATE', auth.uid(), v_old, v_new, v_cols);
    end if;

    return new;
  elsif tg_op = 'DELETE' then
    v_old := to_jsonb(old) - 'updated_at';
    v_pk := coalesce(v_old ->> 'id', '');

    insert into public.audit_logs(table_name, row_pk, action, changed_by, old_data, new_data, changed_columns)
    values (tg_table_name, v_pk, 'DELETE', auth.uid(), v_old, null, '{}'::text[]);

    return old;
  end if;

  return null;
end;
$$;

drop trigger if exists trg_audit_orders on public.orders;
create trigger trg_audit_orders
after insert or update or delete on public.orders
for each row execute function public.audit_row_changes();

drop trigger if exists trg_audit_order_items on public.order_items;
create trigger trg_audit_order_items
after insert or update or delete on public.order_items
for each row execute function public.audit_row_changes();

drop trigger if exists trg_audit_order_item_modifiers on public.order_item_modifiers;
create trigger trg_audit_order_item_modifiers
after insert or update or delete on public.order_item_modifiers
for each row execute function public.audit_row_changes();

drop trigger if exists trg_audit_kitchen_stations on public.kitchen_stations;
create trigger trg_audit_kitchen_stations
after insert or update or delete on public.kitchen_stations
for each row execute function public.audit_row_changes();

alter table public.audit_logs enable row level security;
alter table public.audit_logs force row level security;

drop policy if exists audit_admin_all on public.audit_logs;
create policy audit_admin_all
on public.audit_logs
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());
