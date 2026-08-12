<script setup lang="ts">
// Replaces BeenThereView.vue + WantToTryView.vue — see PRD.md follow-up:
// "I want all of them in one place... I just want one view that I can
// filter." Restaurants already live in one table with a `status` column
// ('want_to_try' | 'been_there'); this was a routing/UI merge, not a data
// model change.
import { computed, onMounted, ref } from 'vue'
import { useQuery, usePowerSync } from '@powersync/vue'
import { useRouter } from 'vue-router'
import { getCurrentPosition, type Coordinates } from '../lib/geo/location'
import { categoryLabel } from '../lib/mapbox/searchBox'
import type { PickedRestaurant } from '../lib/logVisit'
import RestaurantCard from '../components/RestaurantCard.vue'
import RestaurantMap from '../components/RestaurantMap.vue'
import LogVisitPicker from '../components/LogVisitPicker.vue'

const powerSync = usePowerSync()
const router = useRouter()

type ViewMode = 'list' | 'map'
const viewMode = ref<ViewMode>('list')

type StatusFilter = 'all' | 'want_to_try' | 'been_there'
// "Been there" is the more frequent lookup ("have we been here before?")
// per PRD.md "Key flows" / "Browsing" — defaults to it rather than "All".
const statusFilter = ref<StatusFilter>('been_there')

type RestaurantRow = {
  id: string
  name: string
  cuisine: string | null
  price_tier: string | null
  status: string
  latitude: number | null
  longitude: number | null
  location_label: string | null
  photo_url: string | null
  description: string | null
  avg_rating: number | null
  last_visit_date: string | null
  // Whether the most recent visit was flagged "wouldn't go back" — not
  // whether ANY visit ever was. A good later visit un-flags the place; see
  // PRD.md follow-up. Correlated subquery picks that one visit.
  last_wouldnt_go_back: number | null
  visit_count: number
  // SQL-computed haversine distance from `here` (miles) — null until we
  // know the user's location, and for restaurants with no coordinates.
  // Computed in SQL rather than a JS Array.sort comparator: the local
  // wa-sqlite build PowerSync ships DOES implement SQLite's optional math
  // functions (sin/cos/sqrt/asin) — confirmed directly against the running
  // app, not assumed. Postgres/PostGIS never enters into it either way:
  // this query runs against the local PowerSync/SQLite replica, never
  // against Postgres directly.
  distance_miles: number | null
}

// --- Location (proactive, not behind a click) ---
// Sort is no longer a manual "Nearest"/"Highest rated" choice — distance is
// always the primary sort, with rating as a same-distance-bucket tiebreak.
// If location is denied, `here` stays null and every row's distance_miles
// comes back null from the query, degrading gracefully to rating-only order
// (see the ORDER BY below).
const here = ref<Coordinates | null>(null)
const locating = ref(true)
const locationError = ref<string | null>(null)

onMounted(async () => {
  try {
    here.value = await getCurrentPosition()
  } catch (e: any) {
    locationError.value = e.message ?? 'Could not get your location.'
  } finally {
    locating.value = false
  }
})

// Positional `?` params, repeated in the order they appear in the SQL text
// below (lat is used three times, lng twice) — SQLite params are positional,
// not named, so each occurrence needs its own array slot even though the
// value repeats.
const queryParams = computed(() => {
  const lat = here.value?.latitude ?? null
  const lng = here.value?.longitude ?? null
  return [lat, lat, lat, lng, lng]
})

const { data: restaurants } = useQuery<RestaurantRow>(
  `
  SELECT * FROM (
    SELECT r.id, r.name, r.cuisine, r.price_tier, r.status, r.latitude, r.longitude,
           r.location_label, r.photo_url, r.description,
           AVG(v.rating) as avg_rating,
           MAX(v.visit_date) as last_visit_date,
           COUNT(v.id) as visit_count,
           (
             SELECT v2.wouldnt_go_back FROM visits v2
             WHERE v2.restaurant_id = r.id
             ORDER BY v2.visit_date DESC, v2.created_at DESC
             LIMIT 1
           ) as last_wouldnt_go_back,
           (2 * 3958.8 * asin(sqrt(
             sin((r.latitude - ?) * 0.017453293 / 2) * sin((r.latitude - ?) * 0.017453293 / 2) +
             cos(? * 0.017453293) * cos(r.latitude * 0.017453293) *
             sin((r.longitude - ?) * 0.017453293 / 2) * sin((r.longitude - ?) * 0.017453293 / 2)
           ))) as distance_miles
    FROM restaurants r
    LEFT JOIN visits v ON v.restaurant_id = r.id
    GROUP BY r.id
  )
  ORDER BY
    (ROUND(distance_miles / 0.5) * 0.5) IS NULL,
    ROUND(distance_miles / 0.5) * 0.5 ASC,
    avg_rating DESC
  `,
  queryParams,
)

const cuisineFilter = ref('')
const searchQuery = ref('')
// Default hidden — see PRD.md follow-up ("most of the time, you're not
// going to want to see them"). Search always overrides this: a deliberate
// lookup ("have we been there before?") should never come up empty just
// because the place was one we'd skip.
const showSkipped = ref(false)

// Price/tag/rating filters only make sense once there's been-there data to
// filter on — a want-to-try restaurant has no visits (rating) and rarely a
// price tier set yet. Hidden rather than shown-but-empty when the status
// filter is narrowed to "Want to try".
const showBeenThereFilters = computed(() => statusFilter.value !== 'want_to_try')
const priceFilter = ref<Set<string>>(new Set())
const tagFilter = ref<Set<string>>(new Set())
const fourPlusOnly = ref(false)

function toggleInSet(set: Set<string>, value: string) {
  const next = new Set(set)
  next.has(value) ? next.delete(value) : next.add(value)
  return next
}

const cuisines = computed(() => {
  const set = new Set(restaurants.value.map((r) => r.cuisine).filter((c): c is string => !!c))
  return [...set].sort()
})

const priceTiers = computed(() => {
  const set = new Set(restaurants.value.map((r) => r.price_tier).filter((p): p is string => !!p))
  return [...set].sort((a, b) => a.length - b.length) // '$' before '$$' before '$$$'
})

// A tag attaches to either a restaurant directly OR one specific visit —
// see schema.ts. Both link back to a restaurant_id one way or another, so
// this reduces both paths to one restaurant_id -> tag-labels map, reused by
// the tag filter here and by search-matches-tags below.
const { data: tagLinks } = useQuery<{ label: string; restaurant_id: string | null; visit_restaurant_id: string | null }>(`
  SELECT t.label, t.restaurant_id, v.restaurant_id as visit_restaurant_id
  FROM tags t LEFT JOIN visits v ON v.id = t.visit_id
`)

const tagsByRestaurant = computed(() => {
  const map = new Map<string, Set<string>>()
  for (const link of tagLinks.value) {
    const restaurantId = link.restaurant_id ?? link.visit_restaurant_id
    if (!restaurantId) continue
    if (!map.has(restaurantId)) map.set(restaurantId, new Set())
    map.get(restaurantId)!.add(link.label)
  }
  return map
})

const allTags = computed(() => {
  const set = new Set<string>()
  tagLinks.value.forEach((l) => set.add(l.label))
  return [...set].sort()
})

const visible = computed(() => {
  let list: RestaurantRow[] = [...restaurants.value]
  if (statusFilter.value !== 'all') {
    list = list.filter((r) => r.status === statusFilter.value)
  }
  if (cuisineFilter.value) {
    list = list.filter((r) => r.cuisine === cuisineFilter.value)
  }
  if (showBeenThereFilters.value && priceFilter.value.size) {
    list = list.filter((r) => r.price_tier != null && priceFilter.value.has(r.price_tier))
  }
  if (showBeenThereFilters.value && tagFilter.value.size) {
    list = list.filter((r) => {
      const tags = tagsByRestaurant.value.get(r.id)
      return tags && [...tagFilter.value].some((t) => tags.has(t))
    })
  }
  if (showBeenThereFilters.value && fourPlusOnly.value) {
    list = list.filter((r) => (r.avg_rating ?? 0) >= 4)
  }
  const search = searchQuery.value.trim().toLowerCase()
  if (search) {
    list = list.filter(
      (r) => r.name.toLowerCase().includes(search) || [...(tagsByRestaurant.value.get(r.id) ?? [])].some((t) => t.toLowerCase().includes(search)),
    )
  } else if (!showSkipped.value) {
    list = list.filter((r) => !r.last_wouldnt_go_back)
  }
  return list
})

// RestaurantMap wants a plain boolean, not SQLite's 0/1/null.
const mapPlaces = computed(() => visible.value.map((r) => ({ ...r, wouldntGoBack: !!r.last_wouldnt_go_back })))

// --- Add a restaurant ---
// One flow, not two: LogVisitPicker already checks our own restaurants
// before falling through to Mapbox, so picking an existing match just
// pulls it up — no silent insert, no duplicate row. A genuinely new place
// gets added as 'want_to_try' (the neutral "I know this place exists"
// state) and we navigate straight to its detail page, which already has a
// full "Log a visit" form — that's where "I've completed adding the
// restaurant, but I also want to say I was here" gets answered, with no
// new UI needed. Landing on the detail page also means there's never an
// "did this actually do anything?" moment: you're looking straight at the
// thing you just added, regardless of whatever list filter was active.
async function onPick(p: PickedRestaurant) {
  if (p.kind === 'existing') {
    router.push({ name: 'restaurant-detail', params: { id: p.id } })
    return
  }

  // A Mapbox pick can match a restaurant we already have even when
  // LogVisitPicker's (name-based) existing-match search misses it — e.g.
  // searching "Culvers Baraboo" to disambiguate a chain won't match a
  // stored name of just "Culver's". mapbox_id is an exact, unambiguous key
  // for the same real-world place, so check it before inserting — without
  // this, picking a "new" Mapbox result for a place already on the list
  // creates a genuine duplicate row instead of just pulling up the
  // existing one.
  if (p.kind === 'new') {
    const dupes = await powerSync.value.getAll<{ id: string }>(`SELECT id FROM restaurants WHERE mapbox_id = ? LIMIT 1`, [
      p.place.mapboxId,
    ])
    if (dupes.length) {
      router.push({ name: 'restaurant-detail', params: { id: dupes[0].id } })
      return
    }
  }

  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  if (p.kind === 'new') {
    const cuisine = categoryLabel(p.place.category)
    powerSync.value.execute(
      `INSERT INTO restaurants
         (id, name, cuisine, status, latitude, longitude, location_label, mapbox_id, website, phone, created_at, updated_at)
       VALUES (?, ?, ?, 'want_to_try', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, p.place.name, cuisine, p.place.latitude, p.place.longitude, p.place.fullAddress, p.place.mapboxId, p.place.website, p.place.phone, now, now],
    )
  } else {
    powerSync.value.execute(
      `INSERT INTO restaurants (id, name, status, created_at, updated_at) VALUES (?, ?, 'want_to_try', ?, ?)`,
      [id, p.name, now, now],
    )
  }
  // ?new=1 tells the detail page to open straight into edit mode instead
  // of view mode — see RestaurantDetailView.vue's auto-edit watcher.
  router.push({ name: 'restaurant-detail', params: { id }, query: { new: '1' } })
}
</script>

<template>
  <div class="mx-auto max-w-2xl px-4 py-6">
    <div class="mb-4">
      <LogVisitPicker placeholder="Add a restaurant…" @pick="onPick" />
    </div>

    <input
      v-model="searchQuery"
      type="text"
      placeholder="Search by name…"
      class="mb-4 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
    />

    <div class="mb-4 flex flex-wrap items-center gap-3 text-sm">
      <!-- All / Want to try / Been there — replaces the old two-page split. -->
      <div class="flex overflow-hidden rounded-full border border-zinc-200 dark:border-zinc-700">
        <button
          v-for="opt in (['all', 'want_to_try', 'been_there'] as StatusFilter[])"
          :key="opt"
          type="button"
          class="px-3 py-1"
          :class="statusFilter === opt ? 'bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900' : 'text-zinc-500 dark:text-zinc-300'"
          @click="statusFilter = opt"
        >
          {{ opt === 'all' ? 'All' : opt === 'want_to_try' ? 'Want to try' : 'Been there' }}
        </button>
      </div>

      <!-- max-w constrains the CLOSED box — without it, WebKit (the engine
           iOS Chrome actually uses) sizes an unstyled <select> to fit its
           WIDEST option, not just the one currently displayed. `cuisines`
           can include raw, uncurated Mapbox category text ("American
           restaurant, Food, Food and drink, Restaurant") for anything not
           yet edited, which was forcing this box wider than the mobile
           viewport — confirmed via a real WebKit overflow measurement,
           not a hypothetical. The browser ellipsizes the displayed value
           on its own once a max-width is set. -->
      <select
        v-if="cuisines.length"
        v-model="cuisineFilter"
        class="max-w-[9rem] truncate rounded-lg border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
      >
        <option value="">All cuisines</option>
        <option v-for="c in cuisines" :key="c" :value="c">{{ c }}</option>
      </select>

      <button
        v-if="!searchQuery"
        type="button"
        class="text-zinc-500 dark:text-zinc-300 underline decoration-dotted"
        @click="showSkipped = !showSkipped"
      >
        {{ showSkipped ? "Hide places we wouldn't go back" : "Show places we wouldn't go back" }}
      </button>
    </div>

    <!-- Price / tag / 4+ stars — only meaningful once there's been-there
         data to filter on (see showBeenThereFilters). OR within each chip
         group, AND across groups and the other filters above. -->
    <div v-if="showBeenThereFilters && (priceTiers.length || allTags.length)" class="mb-4 flex flex-wrap items-center gap-2 text-sm">
      <button
        v-for="p in priceTiers"
        :key="p"
        type="button"
        class="rounded-full border px-3 py-1"
        :class="priceFilter.has(p) ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900' : 'border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300'"
        @click="priceFilter = toggleInSet(priceFilter, p)"
      >
        {{ p }}
      </button>

      <button
        type="button"
        class="rounded-full border px-3 py-1"
        :class="fourPlusOnly ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900' : 'border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300'"
        @click="fourPlusOnly = !fourPlusOnly"
      >
        4+ stars
      </button>

      <button
        v-for="t in allTags"
        :key="t"
        type="button"
        class="rounded-full border px-3 py-1"
        :class="tagFilter.has(t) ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900' : 'border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300'"
        @click="tagFilter = toggleInSet(tagFilter, t)"
      >
        {{ t }}
      </button>
    </div>

    <div class="mb-4 flex flex-wrap items-center gap-3 text-sm">
      <!-- List/Map applies to whatever's already filtered/sorted above. -->
      <div class="flex overflow-hidden rounded-full border border-zinc-200 dark:border-zinc-700">
        <button
          type="button"
          class="px-3 py-1"
          :class="viewMode === 'list' ? 'bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900' : 'text-zinc-500 dark:text-zinc-300'"
          @click="viewMode = 'list'"
        >
          List
        </button>
        <button
          type="button"
          class="px-3 py-1"
          :class="viewMode === 'map' ? 'bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900' : 'text-zinc-500 dark:text-zinc-300'"
          @click="viewMode = 'map'"
        >
          Map
        </button>
      </div>

      <span v-if="locating" class="text-zinc-400">Finding you…</span>
      <span v-else-if="locationError" class="text-red-500">{{ locationError }}</span>
    </div>

    <div v-if="visible.length === 0" class="text-sm text-zinc-500 dark:text-zinc-300">
      <template v-if="searchQuery">No restaurants match "{{ searchQuery }}".</template>
      <template v-else-if="restaurants.length === 0">Nothing on the list yet — add a place above.</template>
      <template v-else>
        Nothing to show — every match is marked "wouldn't go back."
        <button type="button" class="underline" @click="showSkipped = true">Show them</button>.
      </template>
    </div>

    <RestaurantMap
      v-else-if="viewMode === 'map'"
      :restaurants="mapPlaces"
      :here="here"
      :has-active-search="!!searchQuery.trim()"
    />

    <div v-else class="grid gap-3 sm:grid-cols-2">
      <RouterLink
        v-for="r in visible"
        :key="r.id"
        :to="{ name: 'restaurant-detail', params: { id: r.id } }"
      >
        <RestaurantCard
          :name="r.name"
          :status="r.status"
          :cuisine="r.cuisine"
          :price-tier="r.price_tier"
          :avg-rating="r.avg_rating"
          :distance-miles="r.distance_miles"
          :wouldnt-go-back="!!r.last_wouldnt_go_back"
          :photo-url="r.photo_url"
          :visit-count="r.visit_count"
          :location-label="r.location_label"
          :description="r.description"
          :tags="[...(tagsByRestaurant.get(r.id) ?? [])]"
        />
      </RouterLink>
    </div>
  </div>
</template>
