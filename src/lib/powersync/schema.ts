import { column, Schema, Table } from '@powersync/web'

// Mirrors PRD.md "Core entities". Keep this in sync with the Postgres
// migration in supabase/migrations/ and the stream definitions in
// powersync/sync-streams.yaml — all three describe the same shape from
// three angles (local view, source of truth, what syncs to the client).
//
// PowerSync auto-adds a `text` id column to every table, so it's omitted here.
// Tags are a separate table (rather than an array column) because SQLite
// has no array type — a tag attaches to either a restaurant or a visit via
// whichever foreign key is set, never both.

const restaurants = new Table({
  name: column.text,
  cuisine: column.text,
  price_tier: column.text, // '$' | '$$' | '$$$'
  status: column.text, // 'want_to_try' | 'been_there'
  // Nullable: a manually-entered place may have no coordinates yet.
  latitude: column.real,
  longitude: column.real,
  location_label: column.text, // full address — from Mapbox search, or free text if manually entered
  // Sourced from Mapbox Search Box's /retrieve when the restaurant was
  // added via search rather than typed manually. mapbox_id lets us avoid
  // re-searching if we ever need to refresh a record's details.
  mapbox_id: column.text,
  website: column.text,
  phone: column.text,
  // Free text, written by us — Mapbox only gives a category, not a real
  // description. See PRD.md follow-up.
  description: column.text,
  created_at: column.text, // ISO 8601
  updated_at: column.text, // ISO 8601
})

const visits = new Table({
  restaurant_id: column.text,
  visit_date: column.text, // ISO date (yyyy-mm-dd)
  items_ordered: column.text,
  rating: column.integer, // 1-5
  notes: column.text,
  // General do-not-repeat signal, not sickness-specific — see PRD.md
  // "Decisions locked for v1". 0 or 1.
  wouldnt_go_back: column.integer,
  created_at: column.text,
  updated_at: column.text,
})

const tags = new Table({
  label: column.text,
  restaurant_id: column.text, // set when the tag applies to the place generally
  visit_id: column.text, // set when the tag applies to one specific visit
  created_at: column.text,
})

export const AppSchema = new Schema({
  restaurants,
  visits,
  tags,
})

export type Database = (typeof AppSchema)['types']
export type RestaurantRecord = Database['restaurants']
export type VisitRecord = Database['visits']
export type TagRecord = Database['tags']
