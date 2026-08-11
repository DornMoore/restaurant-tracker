-- Photo upload — see src/lib/powersync/schema.ts. photo_url is a plain
-- permanent URL into a public-read Storage bucket (not a signed one), so it
-- syncs through PowerSync like any other text column; PowerSync only syncs
-- structured rows, never blobs, so the actual image bytes go straight to
-- Storage (src/lib/photoUpload.ts) and only this URL round-trips through
-- the normal sync queue.
alter table restaurants
  add column if not exists photo_url text;

-- Public-read because photos aren't sensitive and a private bucket would
-- need signed URLs, which expire and can't be kept fresh through
-- PowerSync's text-only sync. Writes stay gated to `authenticated`, same
-- posture as every other table (see 0001_init.sql, 0004_grant_authenticated_
-- privileges.sql) — this is a 2-user shared app, not per-user partitioned.
insert into storage.buckets (id, name, public)
values ('restaurant-photos', 'restaurant-photos', true)
on conflict (id) do nothing;

create policy "restaurant-photos: public read"
  on storage.objects for select
  using (bucket_id = 'restaurant-photos');

create policy "restaurant-photos: authenticated write"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'restaurant-photos');

create policy "restaurant-photos: authenticated update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'restaurant-photos');

create policy "restaurant-photos: authenticated delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'restaurant-photos');
