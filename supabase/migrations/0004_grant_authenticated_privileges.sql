-- RLS policies only take effect once a role has base table privileges —
-- they don't grant access on their own. Supabase normally grants these to
-- `authenticated` automatically when a table is created via the dashboard,
-- but that didn't happen for these tables (real-world gap, not something
-- to rely on implicitly). Grant explicitly instead.
--
-- Deliberately NOT granted to `anon` — RLS has no policy for that role on
-- any of these tables, so it would be a privilege with no matching access
-- anyway. Keeping the grant scoped to `authenticated` only matches the RLS
-- design in 0001_init.sql.
grant select, insert, update, delete on public.restaurants to authenticated;
grant select, insert, update, delete on public.visits to authenticated;
grant select, insert, update, delete on public.tags to authenticated;
