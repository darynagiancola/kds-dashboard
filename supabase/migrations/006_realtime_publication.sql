-- 006_realtime_publication.sql
-- Adds KDS tables to Supabase Realtime publication.

do $$
declare
  t text;
begin
  foreach t in array array['orders', 'order_items', 'order_item_modifiers', 'order_status_history']
  loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
