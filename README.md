# Kitchen Display System (KDS) Dashboard

Kanban-style kitchen display built with React, TypeScript, Tailwind CSS, and Supabase realtime subscriptions.

## Stack

- React + TypeScript (Vite)
- Tailwind CSS v4
- Supabase (`@supabase/supabase-js`)

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create a `.env.local` file:

```bash
VITE_SUPABASE_URL=your_project_url
VITE_SUPABASE_ANON_KEY=your_anon_key
```

3. Run development server:

```bash
npm run dev
```

## Demo mode (no Supabase required)

If `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are missing, the app automatically runs in demo mode:

- seeded sample kitchen tickets are shown across **New**, **Prep**, and **Ready**
- each card includes realistic table numbers, menu items, modifiers, elapsed time, and priority labels (**Normal**, **High**, **Rush**)
- new mock incoming orders are added periodically so the board looks live
- you still see a warning banner indicating Supabase is not configured

## GitHub Pages deployment

This project is configured to deploy at:

`https://darynagiancola.github.io/kds-dashboard/`

### 1) Add production environment variables

In your GitHub repository settings, add these Actions secrets:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Path: **Settings -> Secrets and variables -> Actions**

### 2) Enable GitHub Pages source

In **Settings -> Pages**, set:

- **Source:** GitHub Actions

### 3) Deploy

Push to `main`. The workflow at `.github/workflows/deploy-pages.yml` will:

- install dependencies
- run lint
- build using `npm run build:pages` (Vite base path = `/kds-dashboard/`)
- upload `dist/`
- deploy to GitHub Pages

The app base path is explicitly set for Pages builds so assets load correctly under `/kds-dashboard/`.

## 1) Database schema (SQL)

SQL is in [`supabase/schema.sql`](./supabase/schema.sql).

```sql
create extension if not exists "pgcrypto";

create type order_status as enum ('new', 'prep', 'ready');

create table if not exists public.orders (
  id bigint generated always as identity primary key,
  table_number integer not null check (table_number > 0),
  status order_status not null default 'new',
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
```

## 2) React component structure

```text
src/
  App.tsx                           # mounts KdsDashboard
  components/
    KdsDashboard.tsx                # kanban columns + realtime + status updates
    OrderCard.tsx                   # single order card UI + move button
  lib/
    supabaseClient.ts               # Supabase client setup
    time.ts                         # "time since created" formatter
  types/
    orders.ts                       # shared TS types (Order, OrderItem, Modifier, status)
```

## 3) Main dashboard component

`KdsDashboard`:

- loads orders from Supabase with nested `order_items` and `modifiers`
- groups orders into three columns: `new`, `prep`, `ready`
- updates order status with large touch-friendly buttons
- subscribes to realtime changes (`orders`, `order_items`, `modifiers`)
- refreshes UI automatically when records change

Source: [`src/components/KdsDashboard.tsx`](./src/components/KdsDashboard.tsx)

## 4) Order card component

`OrderCard` displays:

- order number
- table number
- items
- modifiers (e.g., "no onion", "well done")
- elapsed time since `created_at`
- status action button (`Move to Prep` / `Move to Ready`)

Source: [`src/components/OrderCard.tsx`](./src/components/OrderCard.tsx)

## 5) Supabase realtime subscription example

```ts
const channel = supabase
  .channel('kds-live-orders')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
    void fetchOrders()
  })
  .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, () => {
    void fetchOrders()
  })
  .on('postgres_changes', { event: '*', schema: 'public', table: 'modifiers' }, () => {
    void fetchOrders()
  })
  .subscribe()
```

This keeps all connected KDS screens in sync when:

- new orders are created
- statuses change
- items/modifiers are added or updated
