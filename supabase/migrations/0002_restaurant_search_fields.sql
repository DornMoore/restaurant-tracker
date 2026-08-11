-- Adds fields populated when a restaurant is added via Mapbox Search Box
-- lookup rather than typed manually. See src/lib/powersync/schema.ts and
-- src/lib/mapbox/searchBox.ts.

alter table restaurants
  add column if not exists mapbox_id text,
  add column if not exists website text,
  add column if not exists phone text;
