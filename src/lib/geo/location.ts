// Real device GPS only — no IP-based fallback. See PRD.md "Key flows" /
// "Location": a coarse IP location defeats the point of "what's near me
// right now."

export type Coordinates = { latitude: number; longitude: number }

export function getCurrentPosition(): Promise<Coordinates> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('Geolocation is not available on this device/browser.'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 10_000 },
    )
  })
}

// No in-app routing/map display beyond a simple hand-off — see PRD.md
// "Key flows" / "Location". These just build deep links; the OS/browser
// decides which app opens them.

export function googleMapsUrl(name: string, address?: string | null): string {
  const query = [name, address].filter(Boolean).join(' ')
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
}

export function appleMapsUrl(name: string, coords?: Coordinates | null): string {
  const params = new URLSearchParams({ q: name })
  if (coords) params.set('ll', `${coords.latitude},${coords.longitude}`)
  return `https://maps.apple.com/?${params}`
}

/** Distance in miles between two coordinates (haversine formula). */
export function distanceMiles(a: Coordinates, b: Coordinates): number {
  const R = 3958.8 // Earth radius, miles
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.latitude - a.latitude)
  const dLon = toRad(b.longitude - a.longitude)
  const lat1 = toRad(a.latitude)
  const lat2 = toRad(b.latitude)

  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Best-effort city extraction from `location_label` (no structured city
 * column exists — see schema.ts). Mapbox's full_address/place_formatted
 * strings are comma-separated, typically "Street, City, State Zip, Country"
 * — city sits three segments from the end when a street is present, or the
 * first segment for a shorter "City, State" label. This is a heuristic, not
 * a guaranteed-correct parse: manually-typed addresses can be in any shape,
 * and it will occasionally be wrong for unusual formats. */
export function cityFromLocationLabel(label: string | null | undefined): string | null {
  if (!label) return null
  const parts = label
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
  if (parts.length >= 3) return parts[parts.length - 3]
  if (parts.length === 2) return parts[0]
  return null
}

/** A rough (lng/lat, not geodesic-precise) bounding box `radiusMiles` around
 * `center` — good enough for framing an initial map view. Longitude degrees
 * shrink toward the poles, so it's scaled by latitude; a fixed 69 mi/degree
 * is used for latitude, which is accurate to within about 1% everywhere. */
export function boundingBoxMiles(
  center: Coordinates,
  radiusMiles: number,
): { west: number; south: number; east: number; north: number } {
  const milesPerDegLat = 69.0
  const milesPerDegLng = 69.0 * Math.cos((center.latitude * Math.PI) / 180)
  const dLat = radiusMiles / milesPerDegLat
  const dLng = radiusMiles / Math.max(milesPerDegLng, 1) // guard the poles
  return {
    west: center.longitude - dLng,
    east: center.longitude + dLng,
    south: center.latitude - dLat,
    north: center.latitude + dLat,
  }
}
