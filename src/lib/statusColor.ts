// Color hierarchy shared between RestaurantCard and RestaurantMap, so the
// same restaurant reads the same way in both views.
//
// Replaces the earlier violet->magenta star-rating-tier scale. Per explicit
// direction: star ratings don't need their own color hierarchy. The only
// thing worth signaling at a glance is status:
//   RED   — been there, and it's on the good list (regardless of star count)
//   WHITE — want to try (no visit yet, "no stars")
//   BLACK — been there, and flagged "wouldn't go back"
// Stars are still shown as text/icons everywhere they were before — color
// reinforces status, it doesn't replace the rating.
export type Status = 'good' | 'want_to_try' | 'skip'

type StatusPalette = { hex: string; tailwind: string; tailwindDark: string }

const PALETTES: Record<Status, StatusPalette> = {
  good: { hex: '#dc2626', tailwind: 'border-l-red-600', tailwindDark: 'dark:border-l-red-400' },
  want_to_try: { hex: '#ffffff', tailwind: 'border-l-zinc-300', tailwindDark: 'dark:border-l-zinc-600' },
  skip: { hex: '#18181b', tailwind: 'border-l-zinc-900', tailwindDark: 'dark:border-l-zinc-100' },
}

/** A restaurant's `status` column plus the most recent visit's
 * `wouldnt_go_back` flag collapse to exactly one of three states. */
export function restaurantStatus(status: string, wouldntGoBack?: boolean | null): Status {
  if (status === 'want_to_try') return 'want_to_try'
  return wouldntGoBack ? 'skip' : 'good'
}

/** Tailwind border classes for RestaurantCard's left-edge accent. */
export function statusBorderClasses(status: string, wouldntGoBack?: boolean | null): string {
  const p = PALETTES[restaurantStatus(status, wouldntGoBack)]
  return `border-zinc-200 border-l-4 ${p.tailwind} dark:border-zinc-800 ${p.tailwindDark}`
}

/** Hex color for RestaurantMap's Mapbox markers (Mapbox needs a real color
 * value, not a class name). */
export function statusHex(status: string, wouldntGoBack?: boolean | null): string {
  return PALETTES[restaurantStatus(status, wouldntGoBack)].hex
}
