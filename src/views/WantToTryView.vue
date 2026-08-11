<script setup lang="ts">
import { computed, ref } from 'vue'
import { useQuery, usePowerSync } from '@powersync/vue'
import RestaurantCard from '../components/RestaurantCard.vue'
import RestaurantMap from '../components/RestaurantMap.vue'
import RestaurantSearchInput from '../components/RestaurantSearchInput.vue'
import { getCurrentPosition, distanceMiles, type Coordinates } from '../lib/geo/location'
import { categoryLabel, type RetrievedPlace } from '../lib/mapbox/searchBox'
import type { RestaurantRecord } from '../lib/powersync/schema'

const powerSync = usePowerSync()

type ViewMode = 'list' | 'map'
const viewMode = ref<ViewMode>('list')

// Quick-add backed by Mapbox search (see RestaurantSearchInput) — picking a
// real result disambiguates multi-location chains and captures
// address/coordinates/website in one step. Falls back to a name-only insert
// when search can't find it or is unavailable (offline), matching PRD.md
// "Decisions locked for v1" — either way it's still just one interaction.
async function addFromSearch(place: RetrievedPlace) {
  const now = new Date().toISOString()
  const cuisine = categoryLabel(place.category)
  await powerSync.value.execute(
    `INSERT INTO restaurants
       (id, name, cuisine, status, latitude, longitude, location_label, mapbox_id, website, phone, created_at, updated_at)
     VALUES (uuid(), ?, ?, 'want_to_try', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [place.name, cuisine, place.latitude, place.longitude, place.fullAddress, place.mapboxId, place.website, place.phone, now, now],
  )
}

async function addManually(name: string) {
  const now = new Date().toISOString()
  await powerSync.value.execute(
    `INSERT INTO restaurants (id, name, status, created_at, updated_at)
     VALUES (uuid(), ?, 'want_to_try', ?, ?)`,
    [name, now, now],
  )
}

const { data: restaurants } = useQuery<RestaurantRecord>(
  `SELECT * FROM restaurants WHERE status = 'want_to_try' ORDER BY created_at DESC`,
)

// Distance sort — the only sort that matters for a not-yet-visited list
// (there's no rating yet). See PRD.md "Key flows" / "Browsing".
const here = ref<Coordinates | null>(null)
const sortByDistance = ref(false)
const locating = ref(false)
const locationError = ref<string | null>(null)

async function enableDistanceSort() {
  locating.value = true
  locationError.value = null
  try {
    here.value = await getCurrentPosition()
    sortByDistance.value = true
  } catch (e: any) {
    locationError.value = e.message ?? 'Could not get your location.'
  } finally {
    locating.value = false
  }
}

const sortedRestaurants = computed(() => {
  const list = [...restaurants.value]
  if (sortByDistance.value && here.value) {
    const origin = here.value
    return list.sort((a, b) => {
      const da = a.latitude != null && a.longitude != null ? distanceMiles(origin, { latitude: a.latitude, longitude: a.longitude }) : Infinity
      const db = b.latitude != null && b.longitude != null ? distanceMiles(origin, { latitude: b.latitude, longitude: b.longitude }) : Infinity
      return da - db
    })
  }
  return list
})

function distanceFor(r: RestaurantRecord): number | null {
  if (!sortByDistance.value || !here.value || r.latitude == null || r.longitude == null) return null
  return distanceMiles(here.value, { latitude: r.latitude, longitude: r.longitude })
}

// RestaurantRecord's name is nullable at the type level (SQLite columns are
// always nullable) even though we never actually insert one without a name.
const mappablePlaces = computed(() => sortedRestaurants.value.map((r) => ({ ...r, name: r.name ?? '' })))
</script>

<template>
  <div class="mx-auto max-w-2xl px-4 py-6">
    <div class="mb-6">
      <RestaurantSearchInput
        placeholder="Place we want to try…"
        :proximity="here ?? undefined"
        @select="addFromSearch"
        @manual="addManually"
      />
    </div>

    <div class="mb-4 flex flex-wrap items-center gap-3 text-sm">
      <button
        type="button"
        class="text-zinc-500 underline decoration-dotted disabled:opacity-50"
        :disabled="locating"
        @click="enableDistanceSort"
      >
        {{ sortByDistance ? 'Sorted by distance' : locating ? 'Locating…' : 'Sort by distance' }}
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

    <div v-if="sortedRestaurants.length === 0" class="text-sm text-zinc-500">
      Nothing on the list yet — add a place above.
    </div>

    <RestaurantMap v-else-if="viewMode === 'map'" :restaurants="mappablePlaces" :here="here" />

    <div v-else class="grid gap-3 sm:grid-cols-2">
      <RouterLink
        v-for="r in sortedRestaurants"
        :key="r.id"
        :to="{ name: 'restaurant-detail', params: { id: r.id } }"
      >
        <RestaurantCard
          :name="r.name ?? ''"
          :cuisine="r.cuisine"
          :price-tier="r.price_tier"
          :distance-miles="distanceFor(r)"
        />
      </RouterLink>
    </div>
  </div>
</template>
