<script setup lang="ts">
import { computed } from 'vue'
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
    distanceMiles?: number | null
    tags?: string[]
    /** Most recent visit was flagged "wouldn't go back" — see PRD.md
     * follow-up. Not permanent: a good later visit clears this. */
    wouldntGoBack?: boolean
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
// warning label.
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
  <!-- Deliberately compact — this is the scan-a-long-list row, not a showcase
       card. No photo, no star rating (both live on the detail page instead;
       see PRD.md follow-up "cards feel a little big" / "scroll through the
       list faster"). Name + one line of secondary facts + tags, done. -->
  <div
    class="rounded-lg border bg-white px-3 py-2 shadow-sm transition hover:shadow-md dark:bg-zinc-900"
    :class="[accentClass, wouldntGoBack && 'opacity-60']"
  >
    <div class="flex items-baseline justify-between gap-2">
      <h3 class="truncate font-medium text-zinc-900 dark:text-zinc-50">{{ name }}</h3>
      <span v-if="distanceMiles != null" class="shrink-0 text-xs text-zinc-400 dark:text-zinc-400">
        {{ distanceMiles.toFixed(1) }} mi
      </span>
    </div>

    <div class="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-zinc-500 dark:text-zinc-300">
      <span v-if="wouldntGoBack">Wouldn't go back</span>
      <template v-else-if="status === 'want_to_try'">
        <span>Want to try</span>
        <span v-if="priceTier || cuisineOrDescription || city">·</span>
      </template>
      <template v-else-if="visitCount">
        <span>Visited {{ visitCount }} {{ visitCount === 1 ? 'time' : 'times' }}</span>
        <span v-if="priceTier || cuisineOrDescription || city">·</span>
      </template>
      <span v-if="priceTier">{{ priceTier }}</span>
      <template v-if="priceTier && cuisineOrDescription">·</template>
      <span v-if="cuisineOrDescription">{{ cuisineOrDescription }}</span>
      <template v-if="(priceTier || cuisineOrDescription) && city">·</template>
      <span v-if="city">{{ city }}</span>
    </div>

    <div v-if="tags.length" class="mt-1 flex flex-wrap gap-1">
      <span
        v-for="tag in tags.slice(0, 3)"
        :key="tag"
        class="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[11px] leading-none text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
      >
        {{ tag }}
      </span>
    </div>
  </div>
</template>
