create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role public.app_role not null default 'waiter',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.kitchen_stations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number bigint generated always as identity unique,
  table_number integer not null check (table_number > 0),
  status public.order_status not null default 'new',
  priority public.order_priority not null default 'normal',
  created_by uuid not null references public.profiles(id),
  station_id uuid references public.kitchen_stations(id) on delete set null,
  note text,
  target_ready_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  name text not null,
  quantity integer not null default 1 check (quantity > 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_item_modifiers (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references public.order_items(id) on delete cascade,
  text text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.order_status_history (
  id bigserial primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  from_status public.order_status,
  to_status public.order_status not null,
  changed_by uuid references public.profiles(id) on delete set null,
  station_id uuid references public.kitchen_stations(id) on delete set null,
  reason text,
  changed_at timestamptz not null default now()
);

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

create index if not exists idx_profiles_role_active
  on public.profiles(role, is_active);

create index if not exists idx_kitchen_stations_active_sort
  on public.kitchen_stations(is_active, sort_order);

create index if not exists idx_orders_status_created_at
  on public.orders(status, created_at);

create index if not exists idx_orders_station_status_created_at
  on public.orders(station_id, status, created_at);

create index if not exists idx_orders_created_by_created_at
  on public.orders(created_by, created_at desc);

create index if not exists idx_orders_active_kds
  on public.orders(created_at)
  where status in ('new', 'in_progress', 'ready');

create index if not exists idx_orders_target_ready_at_open
  on public.orders(target_ready_at)
  where target_ready_at is not null and status <> 'delivered';

create index if not exists idx_order_items_order_id
  on public.order_items(order_id);

create index if not exists idx_order_items_name_trgm
  on public.order_items using gin (name gin_trgm_ops);

create index if not exists idx_order_item_modifiers_order_item_id
  on public.order_item_modifiers(order_item_id);

create index if not exists idx_order_item_modifiers_text_trgm
  on public.order_item_modifiers using gin (text gin_trgm_ops);

create index if not exists idx_order_status_history_order_changed_at
  on public.order_status_history(order_id, changed_at desc);

create index if not exists idx_order_status_history_to_status_changed_at
  on public.order_status_history(to_status, changed_at desc);

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
