-- Restaurant Tracker — initial schema.
-- Mirrors src/lib/powersync/schema.ts and powersync/sync-rules.yaml — all
-- three describe the same shape from three angles (source of truth here,
-- local SQLite view, what syncs to the client). Keep them in step.

create extension if not exists pgcrypto;

create table if not exists restaurants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  cuisine text,
  price_tier text check (price_tier in ('$', '$$', '$$$')),
  status text not null default 'want_to_try' check (status in ('want_to_try', 'been_there')),
  -- Nullable: a manually-entered place may have no coordinates yet.
  latitude double precision,
  longitude double precision,
  location_label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists visits (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  visit_date date not null,
  items_ordered text,
  rating smallint check (rating between 1 and 5),
  notes text,
  -- General do-not-repeat signal, not sickness-specific — see PRD.md
  -- "Decisions locked for v1". If we felt unwell, that's a note, not this flag.
  wouldnt_go_back boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Tags are freeform and attach to either a restaurant OR one visit, never
-- both — see PRD.md "Core entities".
create table if not exists tags (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  restaurant_id uuid references restaurants (id) on delete cascade,
  visit_id uuid references visits (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint tags_exactly_one_parent check (
    (restaurant_id is not null and visit_id is null) or
    (restaurant_id is null and visit_id is not null)
  )
);

create index if not exists visits_restaurant_id_idx on visits (restaurant_id);
create index if not exists tags_restaurant_id_idx on tags (restaurant_id);
create index if not exists tags_visit_id_idx on tags (visit_id);

-- Row Level Security: both accounts share everything, no per-user
-- partitioning — see PRD.md "Who uses it" ("no fancy permissions needed").
-- RLS is still enabled (rather than left off) so a leaked anon key alone
-- can't read/write the data — only an authenticated session can.
alter table restaurants enable row level security;
alter table visits enable row level security;
alter table tags enable row level security;

create policy "authenticated users can do anything" on restaurants
  for all to authenticated using (true) with check (true);
create policy "authenticated users can do anything" on visits
  for all to authenticated using (true) with check (true);
create policy "authenticated users can do anything" on tags
  for all to authenticated using (true) with check (true);

-- PowerSync reads changes via logical replication. REPLICA IDENTITY FULL
-- ensures old row values are available on UPDATE/DELETE, which PowerSync
-- needs to recompute sync buckets correctly.
alter table restaurants replica identity full;
alter table visits replica identity full;
alter table tags replica identity full;

-- Publication name must match the one configured in the PowerSync instance's
-- database connection (PowerSync's default is "powersync"). See README.md.
create publication powersync for table restaurants, visits, tags;
