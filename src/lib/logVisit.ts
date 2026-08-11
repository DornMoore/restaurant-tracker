import type { RetrievedPlace } from './mapbox/searchBox'

// Result of LogVisitPicker — either an existing restaurant (already in our
// data), a new one found via Mapbox search, or a free-typed name when
// search can't find it or is offline. LogVisitView creates the restaurant
// record for 'new'/'manual' before logging the visit.
export type PickedRestaurant =
  | { kind: 'existing'; id: string; name: string; status: string }
  | { kind: 'new'; place: RetrievedPlace }
  | { kind: 'manual'; name: string }
