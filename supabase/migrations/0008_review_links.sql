-- Generalizes the old fixed yelp_url/tripadvisor_url override fields into
-- an arbitrary list of named review-site links per restaurant — see
-- src/lib/powersync/schema.ts. Any real-world site (Yelp, TripAdvisor,
-- Google Reviews, anything else), any number of them, and nothing shows in
-- the app until one is actually added (no more auto-generated search-link
-- fallback).
create table if not exists review_links (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  label text not null,
  url text not null,
  created_at timestamptz not null default now()
);
create index if not exists review_links_restaurant_id_idx on review_links (restaurant_id);

-- Carry forward anything already entered under the old fixed fields — a
-- schema change shouldn't lose data. The old columns themselves are left
-- in place (unused going forward) rather than dropped.
insert into review_links (restaurant_id, label, url)
  select id, 'Yelp', yelp_url from restaurants where yelp_url is not null;
insert into review_links (restaurant_id, label, url)
  select id, 'TripAdvisor', tripadvisor_url from restaurants where tripadvisor_url is not null;

alter table review_links enable row level security;
create policy "authenticated users can do anything" on review_links
  for all to authenticated using (true) with check (true);
-- See 0004_grant_authenticated_privileges.sql — Supabase doesn't always
-- auto-grant base table privileges, and RLS policies alone don't help
-- without them.
grant select, insert, update, delete on review_links to authenticated;
alter table review_links replica identity full;
alter publication powersync add table review_links;
