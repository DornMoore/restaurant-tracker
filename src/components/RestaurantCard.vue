<script setup lang="ts">
import { computed } from 'vue'
import StarRating from './StarRating.vue'
import { ratingBorderClasses } from '../lib/ratingColor'

const props = withDefaults(
  defineProps<{
    name: string
    cuisine?: string | null
    priceTier?: string | null
    avgRating?: number | null
    distanceMiles?: number | null
    tags?: string[]
    /** Most recent visit was flagged "wouldn't go back" — see PRD.md
     * follow-up. Not permanent: a good later visit clears this. */
    wouldntGoBack?: boolean
  }>(),
  { tags: () => [] },
)

// Shared with RestaurantMap's marker colors — see src/lib/ratingColor.ts —
// so the same restaurant reads the same way in both views. A left-edge
// accent rather than a full-card wash, so it reads as a signal, not a
// warning label; stars are still shown regardless, so color is
// reinforcing, never the only signal.
const accentClass = computed(() => ratingBorderClasses(props.avgRating, props.wouldntGoBack))
</script>

<template>
  <!-- Card-based layout, not a plain list row — see PRD.md "Visual direction". -->
  <div
    class="rounded-xl border bg-white p-4 shadow-sm transition hover:shadow-md dark:bg-zinc-900"
    :class="[accentClass, wouldntGoBack && 'opacity-60']"
  >
    <div class="flex items-start justify-between gap-2">
      <h3 class="font-medium text-zinc-900 dark:text-zinc-50">{{ name }}</h3>
      <span v-if="priceTier" class="shrink-0 text-sm text-zinc-500">{{ priceTier }}</span>
    </div>

    <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-zinc-500">
      <span v-if="cuisine">{{ cuisine }}</span>
      <span v-if="cuisine && distanceMiles != null">·</span>
      <span v-if="distanceMiles != null">{{ distanceMiles.toFixed(1) }} mi</span>
    </div>

    <p v-if="wouldntGoBack" class="mt-2 text-sm font-medium text-zinc-500">Wouldn't go back</p>
    <StarRating v-else-if="avgRating != null" :model-value="Math.round(avgRating)" readonly class="mt-2" />

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
</template>
