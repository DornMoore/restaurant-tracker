-- Manual overrides for the Yelp/TripAdvisor hand-off links — their search
-- URLs don't always land on the right page (confirmed in testing: a
-- TripAdvisor search came up empty for a real place). When set, the app
-- uses these instead of generating a search link. See
-- src/lib/powersync/schema.ts.
alter table restaurants
  add column if not exists yelp_url text,
  add column if not exists tripadvisor_url text;
