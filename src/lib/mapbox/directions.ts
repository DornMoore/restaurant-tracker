// Mapbox Directions API — actual driving distance/time, not the haversine
// straight-line estimate in lib/geo/location.ts. See PRD.md follow-up: "is
// that the driving distance, or is that just a direct distance as the crow
// flies?" — this is what makes it the former, at the cost of one network
// call per restaurant page view.
//
// Uses driving-traffic (current conditions), not plain driving, since "how
// long will this actually take me right now" is the more useful number for
// deciding whether to go somewhere — not a traffic-free ideal.
import type { Coordinates } from '../geo/location'

export type DrivingInfo = { distanceMiles: number; durationMinutes: number }

export async function drivingInfo(origin: Coordinates, destination: Coordinates): Promise<DrivingInfo | null> {
  const token = import.meta.env.VITE_MAPBOX_TOKEN
  if (!token) return null

  const coords = `${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}`
  const params = new URLSearchParams({ access_token: token, overview: 'false' })

  const res = await fetch(`https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${coords}?${params}`)
  if (!res.ok) return null
  const body = await res.json()

  const route = body.routes?.[0]
  if (!route) return null

  return {
    distanceMiles: route.distance / 1609.34, // meters -> miles
    durationMinutes: route.duration / 60, // seconds -> minutes
  }
}
