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

// Neither has a public unauthenticated "exact place" deep link the way
// Google/Apple Maps do — these are search-results links, same spirit as
// googleMapsUrl above. Usually surfaces the right place near the top.

export function yelpUrl(name: string, address?: string | null): string {
  const params = new URLSearchParams({ find_desc: name })
  if (address) params.set('find_loc', address)
  return `https://www.yelp.com/search?${params}`
}

export function tripAdvisorUrl(name: string, address?: string | null): string {
  const query = [name, address].filter(Boolean).join(' ')
  return `https://www.tripadvisor.com/Search?q=${encodeURIComponent(query)}`
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
