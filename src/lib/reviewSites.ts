// Curated presets for the review-link label picker — see
// supabase/migrations/0008_review_links.sql. Same "Other" fallback pattern
// as CUISINE_OPTIONS (src/lib/cuisines.ts): pick a preset, or type any
// other site's name as free text — a review link isn't limited to these.
export const REVIEW_SITE_PRESETS = ['Yelp', 'TripAdvisor', 'Google Reviews', 'OpenTable']
