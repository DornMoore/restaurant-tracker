// Color hierarchy shared between RestaurantCard and RestaurantMap, so the
// same restaurant reads the same way in both views — see PRD.md follow-up
// ("use a similar visual hierarchy in the map view").
//
// Modeled as a diverging scale (green = good, warm = bad) around a neutral
// "fine" middle, rather than a plain sequential ramp — the rating has a real
// good-side/bad-side, not just "more or less of one thing".
//
// Deliberately NOT literal red↔green: that's the single worst pair for
// red-green color blindness (the most common form), which is exactly why
// it reads as "the obvious stoplight" in the first place. Green stays for
// "good" (matches the accent already used elsewhere in the app), but the
// bad end is a warm rust/amber rather than saturated red — keeps the
// intuitive "warm = caution" read while pulling back from the worst of that
// confusion. This is a step in the right direction, not a guarantee — so
// every place this scale is used, the actual star count is shown as text
// nearby (card, map popup, mini-list), so color is reinforcing, never the
// only signal.
export type RatingTier = 1 | 2 | 3 | 4 | 5

type TierPalette = { hex: string; tailwind: string; tailwindDark: string }

const TIERS: Record<RatingTier, TierPalette> = {
  5: { hex: '#065f46', tailwind: 'border-l-emerald-700', tailwindDark: 'dark:border-l-emerald-500' },
  4: { hex: '#34d399', tailwind: 'border-l-emerald-400', tailwindDark: 'dark:border-l-emerald-400' },
  3: { hex: '#a8a29e', tailwind: 'border-l-stone-400', tailwindDark: 'dark:border-l-stone-500' },
  2: { hex: '#d97706', tailwind: 'border-l-amber-500', tailwindDark: 'dark:border-l-amber-500' },
  1: { hex: '#c2410c', tailwind: 'border-l-orange-700', tailwindDark: 'dark:border-l-orange-600' },
}

/** Muted, outside the rating gradient entirely — a skipped place isn't
 * "1 star", it's a different kind of signal. */
export const SKIPPED_HEX = '#a1a1aa' // zinc-400
/** No visits yet (want-to-try context) — neutral default, no signal. */
export const UNRATED_HEX = '#52525b' // zinc-600

export function ratingTier(avgRating: number): RatingTier {
  if (avgRating >= 4.5) return 5
  if (avgRating >= 3.5) return 4
  if (avgRating >= 2.5) return 3
  if (avgRating >= 1.5) return 2
  return 1
}

/** Tailwind border classes for RestaurantCard's left-edge accent. */
export function ratingBorderClasses(avgRating: number | null | undefined, wouldntGoBack?: boolean): string {
  if (wouldntGoBack || avgRating == null) return 'border-zinc-200 dark:border-zinc-800'
  const tier = TIERS[ratingTier(avgRating)]
  return `border-zinc-200 border-l-4 ${tier.tailwind} dark:border-zinc-800 ${tier.tailwindDark}`
}

/** Hex color for RestaurantMap's Mapbox markers (Mapbox needs a real color
 * value, not a class name). */
export function ratingMarkerHex(avgRating: number | null | undefined, wouldntGoBack?: boolean): string {
  if (wouldntGoBack) return SKIPPED_HEX
  if (avgRating == null) return UNRATED_HEX
  return TIERS[ratingTier(avgRating)].hex
}
