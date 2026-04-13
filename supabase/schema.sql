create table if not exists public.orders (
  id bigint generated always as identity primary key,
  table_number integer not null check (table_number > 0),
  status text not null check (status in ('new', 'prep', 'ready')) default 'new',
  created_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id bigint generated always as identity primary key,
  order_id bigint not null references public.orders(id) on delete cascade,
  name text not null
);

create table if not exists public.modifiers (
  id bigint generated always as identity primary key,
  order_item_id bigint not null references public.order_items(id) on delete cascade,
  text text not null
);

create index if not exists orders_status_idx on public.orders(status);
create index if not exists orders_created_at_idx on public.orders(created_at);
create index if not exists order_items_order_id_idx on public.order_items(order_id);
create index if not exists modifiers_order_item_id_idx on public.modifiers(order_item_id);
