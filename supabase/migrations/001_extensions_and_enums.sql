-- 001_extensions_and_enums.sql
-- Base extensions and enum types for the KDS backend.

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_role') then
    create type public.app_role as enum ('waiter', 'kitchen', 'admin');
  end if;

  if not exists (select 1 from pg_type where typname = 'order_status') then
    create type public.order_status as enum ('new', 'in_progress', 'ready', 'delivered');
  end if;

  if not exists (select 1 from pg_type where typname = 'order_priority') then
    create type public.order_priority as enum ('normal', 'high', 'rush');
  end if;
end $$;
