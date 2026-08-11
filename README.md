# Restaurant Tracker

A private restaurant log for Dorn and Sara. See [`PRD.md`](./PRD.md) for the
full product spec and the reasoning behind the architecture below.

**Stack:** Vue 3 + Vite + TypeScript, Tailwind CSS, [PowerSync](https://powersync.com)
(local-first sync engine) + [Supabase](https://supabase.com) (Postgres +
Auth), [Mapbox](https://mapbox.com) (restaurant search + map display),
packaged as an installable PWA so it works on the phone and on a Windows
browser from one codebase.

## Setup

This app needs three accounts to run against real data: **Supabase** (the
source of truth), **PowerSync** (the sync engine that bridges it to the
local SQLite store on-device), and **Mapbox** (restaurant lookup + map).
Supabase and PowerSync are free at this scale; Mapbox uses whatever
plan/license you already have.

### 1. Supabase project

1. Create a project at [supabase.com](https://supabase.com/dashboard). Save
   the database password — you'll need it for PowerSync's connection string.
2. In the SQL Editor, run [`supabase/migrations/0001_init.sql`](./supabase/migrations/0001_init.sql).
   This creates the `restaurants`, `visits`, and `tags` tables, enables RLS
   (open to any authenticated user — see `PRD.md` "Who uses it"), and sets
   up the `powersync` publication PowerSync reads from.
3. Under **Authentication → Providers → Email**, turn off "Confirm email" —
   there's no email-verification flow needed for two known users.
4. Under **Authentication → Users**, manually create one account each for
   Dorn and Sara. There's no self-serve signup in this app (see `PRD.md`
   "Who uses it") — accounts are provisioned here, once.
5. Under **Project Settings → API**, note the **Project URL** and **anon
   public key** — you'll need both for `.env.local`.

### 2. PowerSync instance

1. Sign up at [powersync.com](https://powersync.com) and create a new
   instance.
2. Under **DB Connections**, add a connection using the Supabase Postgres
   connection string (**Project Settings → Database → Connection string →
   URI**, with "Display connection pooler" unchecked — the hostname should
   look like `db.<project-ref>.supabase.co`, not a pooler host). Use the
   database password from step 1.
3. Under **Client Auth**, check **"Use Supabase"**. Leave every other field
   on that screen empty (JWKS, JWT secret, JWKS URI, audience, HS256) — your
   project uses Supabase's newer asymmetric signing keys, so checking that
   one box makes PowerSync auto-discover the right keys via JWKS. Manually
   filling in the legacy fields is only for older Supabase projects that use
   a shared JWT secret, and will misconfigure things if your project isn't
   one of those.
4. Open the **Sync Streams** editor (this is what PowerSync instances open
   to by default now — an older "Sync Rules" bucket-based system still
   exists but isn't what needs configuring). Replace the placeholder
   `mytable`/`mycolumn` template entirely with the contents of
   [`powersync/sync-streams.yaml`](./powersync/sync-streams.yaml),
   **Validate**, then **Deploy**.
5. Note the instance's sync URL (General tab) for `.env.local`.

### 3. Mapbox

1. In your [Mapbox account](https://account.mapbox.com/), create a token (or
   reuse one from your existing plan) and enable the **Search Box API**
   scope on it.
2. Restrict the token by URL (add `http://localhost:5173` for local dev, and
   your deployed domain later) — it's a public (`pk.*`) token shipped in the
   client bundle, so restriction is the thing keeping it from being used
   elsewhere, not secrecy.
3. Search Box billing is session-based: the app pairs every autocomplete
   sequence with one `/retrieve` call under a shared session token (see
   `src/lib/mapbox/searchBox.ts`), so typing doesn't rack up per-keystroke
   charges. At two-person usage this stays well within a free/low tier
   regardless.

### 4. Local environment

```bash
cp .env.example .env.local
```

Fill in the four values from above:

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-public-key>
VITE_POWERSYNC_URL=https://<instance>.powersync.journeyapps.com
VITE_MAPBOX_TOKEN=pk.<your-mapbox-token>
```

### 5. Run it

```bash
npm install
npm run dev
```

Open the printed local URL, sign in with one of the two Supabase accounts,
and start logging restaurants. The app works fully offline once loaded —
writes go straight to the local SQLite store and sync to Supabase whenever
a connection is available (see `PRD.md` "Platform and architecture").

To install on a phone: open the dev/deployed URL in the browser, then use
"Add to Home Screen" (iOS Safari) or the install prompt (Android Chrome).

## Project structure

```
src/
  components/
    RestaurantCard.vue, StarRating.vue   Shared UI
    RestaurantSearchInput.vue             Mapbox-backed autocomplete for the want-to-try quick-add
    LogVisitPicker.vue                    Combined search: existing restaurants (recent-visit-first) + Mapbox + manual
    RestaurantMap.vue                     Mapbox GL map (multi-pin list view or single-pin detail)
  views/                One per route: BeenThereView, WantToTryView, LogVisitView,
                         RestaurantDetailView, LoginView
  lib/logVisit.ts        Shared PickedRestaurant type for the log-visit flow
  stores/auth.ts         Pinia store wrapping the Supabase session
  lib/powersync/
    schema.ts            Local SQLite schema (mirrors the Postgres tables)
    SupabaseConnector.ts Bridges PowerSync's CRUD queue to Supabase
    plugin.ts             Wires up the PowerSyncDatabase + Vue plugin
  lib/geo/location.ts    Device GPS, distance math, Maps hand-off links
  lib/mapbox/searchBox.ts Mapbox Search Box API client (suggest/retrieve)
supabase/migrations/     Postgres schema (source of truth)
powersync/sync-streams.yaml What data syncs to the client
```

`schema.ts`, the `supabase/migrations/*.sql` files, and `sync-streams.yaml`
all describe the same tables from different angles — keep them in sync when
the data model changes.

## Known gaps (fine for now, worth knowing about)

- **PWA icons are placeholders.** `vite.config.ts` currently points the
  manifest at `favicon.svg`; add real 192/512 PNGs and an
  `apple-touch-icon` before the home-screen icon matters for real (iOS
  ignores manifest icons and needs its own `<link rel="apple-touch-icon">`).
- **No route guard, by design.** The app works fully before anyone signs
  in (local writes don't need a session — see PRD.md "Platform and
  architecture"), so signing in is a "Sign in" link in the nav (top-right),
  not a wall you have to get through first. Signing in is what makes
  cross-device sync reachable, not what makes the app usable.
- **Tags UI is minimal.** Restaurant-level tags can be added from the
  detail page; visit-level tags aren't wired into the visit form yet.
- **`LogVisitPicker`'s dropdown has no keyboard arrow-key navigation** (tap
  only) — `RestaurantSearchInput`'s simpler single-group picker still has it.
- **No rich description field.** Mapbox's Search Box gives name, address,
  category, phone, and website — not the kind of editorial blurb Google
  Places sometimes has. `cuisine` gets prefilled from Mapbox's category on
  search-add, which is the closest thing to a description right now.
- **`mapbox-gl` is a large dependency** (~500KB gzipped) — an accepted
  tradeoff for using Mapbox specifically rather than a lighter open-source
  map, per the product decision behind this.
