// Every Mapbox-hosted standard base map style, confirmed live against
// Mapbox's Styles API (each returned 200 for this project's token) rather
// than assumed from docs. Navigation Day/Night are our two main basemaps
// — see PRD.md follow-up — paired to the app's light/dark theme
// (src/stores/theme.ts) rather than picked independently. The full list
// stays available in RestaurantMap's picker for ad hoc exploration.
export type BaseMapStyle = { id: string; label: string; url: string }

export const BASE_MAP_STYLES: BaseMapStyle[] = [
  { id: 'standard', label: 'Standard', url: 'mapbox://styles/mapbox/standard' },
  { id: 'standard-satellite', label: 'Standard Satellite', url: 'mapbox://styles/mapbox/standard-satellite' },
  { id: 'streets-v12', label: 'Streets', url: 'mapbox://styles/mapbox/streets-v12' },
  { id: 'outdoors-v12', label: 'Outdoors', url: 'mapbox://styles/mapbox/outdoors-v12' },
  { id: 'light-v11', label: 'Light', url: 'mapbox://styles/mapbox/light-v11' },
  { id: 'dark-v11', label: 'Dark', url: 'mapbox://styles/mapbox/dark-v11' },
  { id: 'satellite-v9', label: 'Satellite', url: 'mapbox://styles/mapbox/satellite-v9' },
  { id: 'satellite-streets-v12', label: 'Satellite Streets', url: 'mapbox://styles/mapbox/satellite-streets-v12' },
  { id: 'navigation-day-v1', label: 'Navigation Day', url: 'mapbox://styles/mapbox/navigation-day-v1' },
  { id: 'navigation-night-v1', label: 'Navigation Night', url: 'mapbox://styles/mapbox/navigation-night-v1' },
]

export const NAV_DAY_ID = 'navigation-day-v1'
export const NAV_NIGHT_ID = 'navigation-night-v1'

/** The basemap for the given app theme — Navigation Day for light,
 * Navigation Night for dark. This is what a map opens with, and what the
 * light/dark toggle switches any open map to. */
export function styleForTheme(theme: 'light' | 'dark'): BaseMapStyle {
  const id = theme === 'dark' ? NAV_NIGHT_ID : NAV_DAY_ID
  return BASE_MAP_STYLES.find((s) => s.id === id) ?? BASE_MAP_STYLES[0]
}
