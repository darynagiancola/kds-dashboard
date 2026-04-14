-- 003_updated_at_and_profile_bootstrap.sql
-- Generic updated_at trigger + auto profile creation from auth.users.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_set_updated_at on public.profiles;
create trigger trg_profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists trg_kitchen_stations_set_updated_at on public.kitchen_stations;
create trigger trg_kitchen_stations_set_updated_at
before update on public.kitchen_stations
for each row execute function public.set_updated_at();

drop trigger if exists trg_orders_set_updated_at on public.orders;
create trigger trg_orders_set_updated_at
before update on public.orders
for each row execute function public.set_updated_at();

drop trigger if exists trg_order_items_set_updated_at on public.order_items;
create trigger trg_order_items_set_updated_at
before update on public.order_items
for each row execute function public.set_updated_at();

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', 'User'),
    coalesce(
      case
        when new.raw_user_meta_data ? 'role'
         and (new.raw_user_meta_data ->> 'role') in ('waiter', 'kitchen', 'admin')
        then (new.raw_user_meta_data ->> 'role')::public.app_role
      end,
      'waiter'::public.app_role
    )
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_handle_new_auth_user on auth.users;
create trigger trg_handle_new_auth_user
after insert on auth.users
for each row execute function public.handle_new_auth_user();
