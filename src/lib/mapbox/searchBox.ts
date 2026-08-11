// Mapbox Search Box API — restaurant lookup used when adding a place, so we
// capture a real address/coordinates/website instead of hoping a typed name
// is unambiguous (multi-location chains show up as distinct results, each
// with its own address). Docs: https://docs.mapbox.com/api/search/search-box/
//
// Billing is session-based: pair every /suggest sequence (as the user types)
// with exactly one /retrieve call under the same session_token, then start a
// fresh token for the next search. Reusing a token across unrelated searches
// or skipping /retrieve doesn't save money — it just breaks how Mapbox
// attributes the session.

const BASE_URL = 'https://api.mapbox.com/search/searchbox/v1'

// Restrict search to places where you'd actually eat/drink — not hospitals,
// retail, or other POI types Mapbox's broader database includes. Mapbox
// groups these under one parent category rather than requiring every
// specific subtype (restaurant, bar, cafe, coffee shop, brewery, etc.)
// listed individually.
const FOOD_AND_DRINK_CATEGORY = 'food_and_drink'

export type PlaceSuggestion = {
  mapboxId: string
  name: string
  fullAddress: string
  category: string[]
}

export type RetrievedPlace = {
  mapboxId: string
  name: string
  fullAddress: string
  latitude: number
  longitude: number
  category: string[]
  website: string | null
  phone: string | null
}

export function newSessionToken(): string {
  return crypto.randomUUID()
}

/** Turns Mapbox's poi_category array into a readable stand-in for cuisine
 * (e.g. `["italian_restaurant"]` -> "Italian restaurant"). Mapbox doesn't
 * give a prose description, so this is the closest thing to one. */
export function categoryLabel(categories: string[]): string | null {
  if (!categories.length) return null
  return categories.map((c) => c.charAt(0).toUpperCase() + c.slice(1).replaceAll('_', ' ')).join(', ')
}

function accessToken(): string {
  const token = import.meta.env.VITE_MAPBOX_TOKEN
  if (!token) throw new Error('VITE_MAPBOX_TOKEN is not set — see .env.example')
  return token
}

export async function suggestPlaces(
  query: string,
  sessionToken: string,
  proximity?: { latitude: number; longitude: number },
): Promise<PlaceSuggestion[]> {
  if (query.trim().length < 2) return []

  const params = new URLSearchParams({
    q: query,
    session_token: sessionToken,
    access_token: accessToken(),
    types: 'poi',
    poi_category: FOOD_AND_DRINK_CATEGORY,
    limit: '8',
  })
  if (proximity) {
    params.set('proximity', `${proximity.longitude},${proximity.latitude}`)
  }

  const res = await fetch(`${BASE_URL}/suggest?${params}`)
  if (!res.ok) throw new Error(`Mapbox suggest failed: ${res.status}`)
  const body = await res.json()

  return (body.suggestions ?? []).map((s: any) => ({
    mapboxId: s.mapbox_id,
    name: s.name,
    fullAddress: s.full_address ?? s.place_formatted ?? '',
    category: s.poi_category ?? [],
  }))
}

export async function retrievePlace(mapboxId: string, sessionToken: string): Promise<RetrievedPlace | null> {
  const params = new URLSearchParams({
    session_token: sessionToken,
    access_token: accessToken(),
  })

  const res = await fetch(`${BASE_URL}/retrieve/${encodeURIComponent(mapboxId)}?${params}`)
  if (!res.ok) throw new Error(`Mapbox retrieve failed: ${res.status}`)
  const body = await res.json()

  const feature = body.features?.[0]
  if (!feature) return null

  const props = feature.properties
  return {
    mapboxId: props.mapbox_id,
    name: props.name,
    fullAddress: props.full_address ?? props.place_formatted ?? '',
    latitude: props.coordinates?.latitude ?? feature.geometry?.coordinates?.[1],
    longitude: props.coordinates?.longitude ?? feature.geometry?.coordinates?.[0],
    category: props.poi_category ?? [],
    website: props.metadata?.website ?? null,
    phone: props.metadata?.phone ?? null,
  }
}
