<script setup lang="ts">
import { computed } from 'vue'
import StarRating from './StarRating.vue'
import { statusBorderClasses } from '../lib/statusColor'
import { cityFromLocationLabel } from '../lib/geo/location'

const props = withDefaults(
  defineProps<{
    name: string
    /** 'want_to_try' | 'been_there' — drives the red/white/black accent via
     * src/lib/statusColor.ts, together with wouldntGoBack. */
    status: string
    cuisine?: string | null
    priceTier?: string | null
    avgRating?: number | null
    distanceMiles?: number | null
    tags?: string[]
    /** Most recent visit was flagged "wouldn't go back" — see PRD.md
     * follow-up. Not permanent: a good later visit clears this. */
    wouldntGoBack?: boolean
    photoUrl?: string | null
    visitCount?: number
    /** Full address text — city is a best-effort parse of this, not a real
     * structured field. See cityFromLocationLabel(). */
    locationLabel?: string | null
    /** Your own "About this place" text — takes over from `cuisine` on the
     * card once it exists, since cuisine is often just Mapbox's raw
     * category text (e.g. "American restaurant, Food, Food and drink,
     * Restaurant") until you've cleaned it up. */
    description?: string | null
  }>(),
  { tags: () => [] },
)

// Shared with RestaurantMap's marker colors — see src/lib/statusColor.ts —
// so the same restaurant reads the same way in both views. A left-edge
// accent rather than a full-card wash, so it reads as a signal, not a
// warning label; stars are still shown regardless, so color is
// reinforcing, never the only signal.
const accentClass = computed(() => statusBorderClasses(props.status, props.wouldntGoBack))
const city = computed(() => cityFromLocationLabel(props.locationLabel))

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}
const cuisineOrDescription = computed(() => {
  const d = props.description?.trim()
  return d ? truncate(d, 60) : props.cuisine
})
</script>

<template>
  <!-- Card-based layout, not a plain list row — see PRD.md "Visual direction". -->
  <div
    class="overflow-hidden rounded-xl border bg-white shadow-sm transition hover:shadow-md dark:bg-zinc-900"
    :class="[accentClass, wouldntGoBack && 'opacity-60']"
  >
    <!-- No placeholder box when absent — most cards won't have a photo yet,
         and an empty gray box reads as "broken", not "no photo". -->
    <img v-if="photoUrl" :src="photoUrl" :alt="name" class="h-36 w-full object-cover" />

    <div class="p-4">
      <h3 class="font-medium text-zinc-900 dark:text-zinc-50">{{ name }}</h3>

      <p v-if="wouldntGoBack" class="mt-1 text-sm font-medium text-zinc-500">Wouldn't go back</p>
      <StarRating v-else-if="avgRating != null" :model-value="Math.round(avgRating)" readonly class="mt-1" />
      <p v-else-if="status === 'want_to_try'" class="mt-1 text-sm text-zinc-400 dark:text-zinc-500">Want to try</p>

      <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-zinc-500">
        <span v-if="priceTier || cuisineOrDescription || city">
          <template v-if="priceTier">{{ priceTier }}</template>
          <template v-if="priceTier && cuisineOrDescription"> · </template>
          <template v-if="cuisineOrDescription">{{ cuisineOrDescription }}</template>
          <template v-if="(priceTier || cuisineOrDescription) && city"> · </template>
          <template v-if="city">{{ city }}</template>
        </span>
      </div>

      <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-zinc-500">
        <span v-if="distanceMiles != null">{{ distanceMiles.toFixed(1) }} mi</span>
        <span v-if="visitCount">Visited {{ visitCount }} {{ visitCount === 1 ? 'time' : 'times' }}</span>
      </div>

      <div v-if="tags.length" class="mt-2 flex flex-wrap gap-1">
        <span
          v-for="tag in tags.slice(0, 3)"
          :key="tag"
          class="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
        >
          {{ tag }}
        </span>
      </div>
    </div>
  </div>
</template>
