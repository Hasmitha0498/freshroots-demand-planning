-- Explicit Data API grants for the server-only service_role.
-- Newer Supabase projects may not auto-grant table privileges to API roles,
-- in which case the Data API cannot see the tables at all. anon and
-- authenticated deliberately get NO grants (RLS also denies them).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant usage on schema public to service_role';
    execute 'grant select, insert, update, delete on all tables in schema public to service_role';
    execute 'grant usage, select on all sequences in schema public to service_role';
    execute 'grant execute on function public.claim_recommendations_for_po(uuid, uuid[]) to service_role';
  end if;
end $$;

notify pgrst, 'reload schema';
