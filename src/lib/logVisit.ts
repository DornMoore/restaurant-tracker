import type { RetrievedPlace } from './mapbox/searchBox'

// Result of LogVisitPicker — either an existing restaurant (already in our
// data), a new one found via Mapbox search, or a free-typed name when
// search can't find it or is offline. RestaurantsView's onPick() creates
// the restaurant record for 'new'/'manual' and navigates to its detail
// page; 'existing' just navigates there directly.
export type PickedRestaurant =
  | { kind: 'existing'; id: string; name: string; status: string }
  | { kind: 'new'; place: RetrievedPlace }
  | { kind: 'manual'; name: string }
