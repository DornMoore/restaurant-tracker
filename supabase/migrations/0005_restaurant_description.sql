-- Free-text description, written by us — Mapbox's Search Box only gives a
-- category, not a real description. See src/lib/powersync/schema.ts.
alter table restaurants
  add column if not exists description text;
