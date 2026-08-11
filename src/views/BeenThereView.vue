<script setup lang="ts">
import { computed, ref } from 'vue'
import { useQuery } from '@powersync/vue'
import { getCurrentPosition, distanceMiles, type Coordinates } from '../lib/geo/location'
import RestaurantCard from '../components/RestaurantCard.vue'
import RestaurantMap from '../components/RestaurantMap.vue'

type ViewMode = 'list' | 'map'
const viewMode = ref<ViewMode>('list')

type BeenThereRow = {
  id: string
  name: string
  cuisine: string | null
  price_tier: string | null
  latitude: number | null
  longitude: number | null
  avg_rating: number | null
  last_visit_date: string | null
  // Whether the most recent visit was flagged "wouldn't go back" — not
  // whether ANY visit ever was. A good later visit un-flags the place; see
  // PRD.md follow-up on this. Correlated subquery picks that one visit.
  last_wouldnt_go_back: number | null
}

// Sorting matters more than filtering here — see PRD.md "Key flows" /
// "Browsing". Rating lives on visits, not the restaurant, so we aggregate.
const { data: restaurants } = useQuery<BeenThereRow>(`
  SELECT r.id, r.name, r.cuisine, r.price_tier, r.latitude, r.longitude,
         AVG(v.rating) as avg_rating, MAX(v.visit_date) as last_visit_date,
         (
           SELECT v2.wouldnt_go_back FROM visits v2
           WHERE v2.restaurant_id = r.id
           ORDER BY v2.visit_date DESC, v2.created_at DESC
           LIMIT 1
         ) as last_wouldnt_go_back
  FROM restaurants r
  LEFT JOIN visits v ON v.restaurant_id = r.id
  WHERE r.status = 'been_there'
  GROUP BY r.id
`)

type SortMode = 'rating' | 'distance'
const sortMode = ref<SortMode>('rating')
const cuisineFilter = ref('')
const searchQuery = ref('')
// Default hidden — see PRD.md follow-up. Search always overrides this: a
// deliberate lookup ("have we been there before?") should never come up
// empty just because the place was one we'd skip.
const showSkipped = ref(false)

const here = ref<Coordinates | null>(null)
const locating = ref(false)
const locationError = ref<string | null>(null)

async function sortByDistance() {
  locating.value = true
  locationError.value = null
  try {
    here.value = await getCurrentPosition()
    sortMode.value = 'distance'
  } catch (e: any) {
    locationError.value = e.message ?? 'Could not get your location.'
  } finally {
    locating.value = false
  }
}

// Low-priority per PRD ("nice to have" rather than something to lean on) —
// simple client-side filter rather than a dedicated SQL param.
const cuisines = computed(() => {
  const set = new Set(restaurants.value.map((r) => r.cuisine).filter((c): c is string => !!c))
  return [...set].sort()
})

const visible = computed(() => {
  let list: BeenThereRow[] = [...restaurants.value]
  if (cuisineFilter.value) {
    list = list.filter((r) => r.cuisine === cuisineFilter.value)
  }
  const search = searchQuery.value.trim().toLowerCase()
  if (search) {
    list = list.filter((r) => r.name.toLowerCase().includes(search))
  } else if (!showSkipped.value) {
    list = list.filter((r) => !r.last_wouldnt_go_back)
  }
  if (sortMode.value === 'distance' && here.value) {
    const origin = here.value
    list.sort((a, b) => {
      const da = a.latitude != null && a.longitude != null ? distanceMiles(origin, { latitude: a.latitude, longitude: a.longitude }) : Infinity
      const db = b.latitude != null && b.longitude != null ? distanceMiles(origin, { latitude: b.latitude, longitude: b.longitude }) : Infinity
      return da - db
    })
  } else {
    list.sort((a, b) => (b.avg_rating ?? 0) - (a.avg_rating ?? 0))
  }
  return list
})

// RestaurantMap wants a plain boolean, not SQLite's 0/1/null.
const mapPlaces = computed(() => visible.value.map((r) => ({ ...r, wouldntGoBack: !!r.last_wouldnt_go_back })))

function distanceFor(r: BeenThereRow): number | null {
  if (sortMode.value !== 'distance' || !here.value || r.latitude == null || r.longitude == null) return null
  return distanceMiles(here.value, { latitude: r.latitude, longitude: r.longitude })
}
</script>

<template>
  <div class="mx-auto max-w-2xl px-4 py-6">
    <RouterLink
      :to="{ name: 'log-visit' }"
      class="mb-4 inline-block rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-50 dark:text-zinc-900"
    >
      + Log a visit
    </RouterLink>

    <input
      v-model="searchQuery"
      type="text"
      placeholder="Have we been here before? Search by name…"
      class="mb-4 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
    />

    <div class="mb-4 flex flex-wrap items-center gap-3 text-sm">
      <button
        type="button"
        class="rounded-full px-3 py-1"
        :class="sortMode === 'rating' ? 'bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'"
        @click="sortMode = 'rating'"
      >
        Highest rated
      </button>
      <button
        type="button"
        class="rounded-full px-3 py-1"
        :class="sortMode === 'distance' ? 'bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'"
        :disabled="locating"
        @click="sortByDistance"
      >
        {{ locating ? 'Locating…' : 'Nearest' }}
      </button>

      <select
        v-if="cuisines.length"
        v-model="cuisineFilter"
        class="rounded-lg border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
      >
        <option value="">All cuisines</option>
        <option v-for="c in cuisines" :key="c" :value="c">{{ c }}</option>
      </select>

      <button
        v-if="!searchQuery"
        type="button"
        class="text-zinc-500 underline decoration-dotted"
        @click="showSkipped = !showSkipped"
      >
        {{ showSkipped ? 'Hide places we\'d skip' : "Show places we'd skip" }}
      </button>

      <!-- List/Map applies to whatever's already filtered/sorted above. -->
      <div class="ml-auto flex overflow-hidden rounded-full border border-zinc-200 dark:border-zinc-700">
        <button
          type="button"
          class="px-3 py-1"
          :class="viewMode === 'list' ? 'bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900' : 'text-zinc-500'"
          @click="viewMode = 'list'"
        >
          List
        </button>
        <button
          type="button"
          class="px-3 py-1"
          :class="viewMode === 'map' ? 'bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900' : 'text-zinc-500'"
          @click="viewMode = 'map'"
        >
          Map
        </button>
      </div>

      <span v-if="locationError" class="w-full text-red-500">{{ locationError }}</span>
    </div>

    <div v-if="visible.length === 0" class="text-sm text-zinc-500">
      <template v-if="searchQuery">No restaurants match "{{ searchQuery }}".</template>
      <template v-else-if="restaurants.length === 0">No visits logged yet — log one from a restaurant's page.</template>
      <template v-else>
        Nothing to show — every been-there place is marked "wouldn't go back."
        <button type="button" class="underline" @click="showSkipped = true">Show them</button>.
      </template>
    </div>

    <RestaurantMap v-else-if="viewMode === 'map'" :restaurants="mapPlaces" :here="here" />

    <div v-else class="grid gap-3 sm:grid-cols-2">
      <RouterLink
        v-for="r in visible"
        :key="r.id"
        :to="{ name: 'restaurant-detail', params: { id: r.id } }"
      >
        <RestaurantCard
          :name="r.name"
          :cuisine="r.cuisine"
          :price-tier="r.price_tier"
          :avg-rating="r.avg_rating"
          :distance-miles="distanceFor(r)"
          :wouldnt-go-back="!!r.last_wouldnt_go_back"
        />
      </RouterLink>
    </div>
  </div>
</template>
