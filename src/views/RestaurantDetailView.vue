<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useQuery, usePowerSync, useStatus } from '@powersync/vue'
import { useRouter } from 'vue-router'
import LocationPicker from '../components/LocationPicker.vue'
import RestaurantMap from '../components/RestaurantMap.vue'
import StarRating from '../components/StarRating.vue'
import { appleMapsUrl, distanceMiles, getCurrentPosition, googleMapsUrl, tripAdvisorUrl, yelpUrl, type Coordinates } from '../lib/geo/location'
import { drivingInfo } from '../lib/mapbox/directions'
import { CUISINE_OPTIONS } from '../lib/cuisines'
import { uploadRestaurantPhoto } from '../lib/photoUpload'
import type { RestaurantRecord, VisitRecord, TagRecord } from '../lib/powersync/schema'

const props = defineProps<{ id: string }>()
const powerSync = usePowerSync()
const router = useRouter()
const status = useStatus()

const { data: restaurantRows } = useQuery<RestaurantRecord>(
  `SELECT * FROM restaurants WHERE id = ?`,
  [props.id],
)
const restaurant = computed(() => restaurantRows.value[0] ?? null)

const googleUrl = computed(() => restaurant.value && googleMapsUrl(restaurant.value.name ?? '', restaurant.value.location_label))
const appleUrl = computed(() =>
  restaurant.value &&
  appleMapsUrl(
    restaurant.value.name ?? '',
    restaurant.value.latitude != null && restaurant.value.longitude != null
      ? { latitude: restaurant.value.latitude, longitude: restaurant.value.longitude }
      : null,
  ),
)
// Manual overrides win — their generated search links don't always land on
// the right page (confirmed in testing). See PRD.md follow-up.
const yelpLink = computed(
  () => restaurant.value?.yelp_url || (restaurant.value && yelpUrl(restaurant.value.name ?? '', restaurant.value.location_label)),
)
const tripAdvisorLink = computed(
  () =>
    restaurant.value?.tripadvisor_url ||
    (restaurant.value && tripAdvisorUrl(restaurant.value.name ?? '', restaurant.value.location_label)),
)

const { data: visits } = useQuery<VisitRecord>(
  `SELECT * FROM visits WHERE restaurant_id = ? ORDER BY visit_date DESC`,
  [props.id],
)

const { data: restaurantTags } = useQuery<TagRecord>(
  `SELECT * FROM tags WHERE restaurant_id = ?`,
  [props.id],
)

// Single-pin map + hand-off links — no in-app routing, just "here's where
// it is" and a tap out to whichever maps app handles the rest. See PRD.md
// "Key flows" / "Location". Colored the same way as everywhere else — see
// src/lib/statusColor.ts — using the same visits already loaded below.
const avgRating = computed(() => {
  const rated = visits.value.filter((v) => v.rating != null)
  return rated.length ? rated.reduce((sum, v) => sum + (v.rating ?? 0), 0) / rated.length : null
})
const mostRecentWouldntGoBack = computed(() => !!visits.value[0]?.wouldnt_go_back)
const mapPlaces = computed(() =>
  restaurant.value
    ? [
        {
          ...restaurant.value,
          name: restaurant.value.name ?? '',
          status: restaurant.value.status ?? 'been_there',
          avg_rating: avgRating.value,
          wouldntGoBack: mostRecentWouldntGoBack.value,
        },
      ]
    : [],
)

// Always know how far away this place is, without asking — see PRD.md
// follow-up ("by default, let's always get the current location"). Driving
// time (via Mapbox Directions) is the useful number; straight-line distance
// is what we show while that's loading or if the Directions call fails —
// still better than nothing, and it's what was here before this.
const userLocation = ref<Coordinates | null>(null)
const driving = ref<{ distanceMiles: number; durationMinutes: number } | null>(null)
const straightLineMiles = ref<number | null>(null)
const distanceLoading = ref(false)

onMounted(async () => {
  try {
    userLocation.value = await getCurrentPosition()
  } catch {
    // No location available (denied/unsupported) — distanceText just won't show.
  }
})

watch(
  [userLocation, restaurant],
  async ([here, r]) => {
    driving.value = null
    straightLineMiles.value = null
    if (!here || !r || r.latitude == null || r.longitude == null) return

    const dest = { latitude: r.latitude, longitude: r.longitude }
    straightLineMiles.value = distanceMiles(here, dest)

    distanceLoading.value = true
    try {
      driving.value = await drivingInfo(here, dest)
    } catch {
      driving.value = null // straightLineMiles is still shown below
    } finally {
      distanceLoading.value = false
    }
  },
  { immediate: true },
)

const distanceText = computed(() => {
  if (driving.value) {
    return `${Math.round(driving.value.durationMinutes)} min drive (${driving.value.distanceMiles.toFixed(1)} mi)`
  }
  if (distanceLoading.value) return 'Checking drive time…'
  if (straightLineMiles.value != null) return `${straightLineMiles.value.toFixed(1)} mi away (straight-line)`
  return null
})

// --- Log a visit ---
// A restaurant can rack up any number of visits over time — see PRD.md
// "Core entities". Logging a visit against a want-to-try place converts it.
const visitDate = ref(new Date().toISOString().slice(0, 10))
const itemsOrdered = ref('')
const rating = ref(0)
const notes = ref('')
const wouldntGoBack = ref(false)

async function logVisit() {
  const now = new Date().toISOString()
  await powerSync.value.execute(
    `INSERT INTO visits
       (id, restaurant_id, visit_date, items_ordered, rating, notes, wouldnt_go_back, created_at, updated_at)
     VALUES (uuid(), ?, ?, ?, ?, ?, ?, ?, ?)`,
    [props.id, visitDate.value, itemsOrdered.value, rating.value || null, notes.value, wouldntGoBack.value ? 1 : 0, now, now],
  )

  if (restaurant.value?.status === 'want_to_try') {
    await powerSync.value.execute(`UPDATE restaurants SET status = 'been_there', updated_at = ? WHERE id = ?`, [
      now,
      props.id,
    ])
  }

  itemsOrdered.value = ''
  rating.value = 0
  notes.value = ''
  wouldntGoBack.value = false
  visitDate.value = new Date().toISOString().slice(0, 10)
}

// --- Edit an existing visit ---
const editingVisitId = ref<string | null>(null)
const editDate = ref('')
const editItems = ref('')
const editRating = ref(0)
const editNotes = ref('')
const editWouldntGoBack = ref(false)

function startEdit(visit: VisitRecord) {
  editingVisitId.value = visit.id
  editDate.value = visit.visit_date ?? ''
  editItems.value = visit.items_ordered ?? ''
  editRating.value = visit.rating ?? 0
  editNotes.value = visit.notes ?? ''
  editWouldntGoBack.value = !!visit.wouldnt_go_back
}

function cancelEdit() {
  editingVisitId.value = null
}

async function saveEdit() {
  if (!editingVisitId.value) return
  await powerSync.value.execute(
    `UPDATE visits
     SET visit_date = ?, items_ordered = ?, rating = ?, notes = ?, wouldnt_go_back = ?, updated_at = ?
     WHERE id = ?`,
    [
      editDate.value,
      editItems.value,
      editRating.value || null,
      editNotes.value,
      editWouldntGoBack.value ? 1 : 0,
      new Date().toISOString(),
      editingVisitId.value,
    ],
  )
  editingVisitId.value = null
}

// --- Tags (freeform, restaurant-level here) ---
const newTag = ref('')
async function addTag() {
  const label = newTag.value.trim()
  if (!label) return
  await powerSync.value.execute(
    `INSERT INTO tags (id, label, restaurant_id, created_at) VALUES (uuid(), ?, ?, ?)`,
    [label, props.id, new Date().toISOString()],
  )
  newTag.value = ''
}

// --- Edit the restaurant itself ---
// Covers everything the add-flows can't: fixing/adding coordinates when
// the Mapbox lookup missed the place entirely, picking a category from a
// curated list instead of Mapbox's raw one, writing a real description,
// correcting any field. See PRD.md follow-up.
const editingRestaurant = ref(false)
const editName = ref('')
const editCuisineSelect = ref('') // one of CUISINE_OPTIONS, '__other__', or '' (none set)
const editCuisineOther = ref('')
const editPriceTier = ref('')
const editDescription = ref('')
const editLocationLabel = ref('')
const editWebsite = ref('')
const editPhone = ref('')
const editYelpUrl = ref('')
const editTripAdvisorUrl = ref('')
const editCoords = ref<Coordinates | null>(null)

function startEditRestaurant() {
  if (!restaurant.value) return
  editName.value = restaurant.value.name ?? ''

  const cur = restaurant.value.cuisine ?? ''
  if (cur && CUISINE_OPTIONS.includes(cur)) {
    editCuisineSelect.value = cur
    editCuisineOther.value = ''
  } else {
    // Not in the curated list (e.g. Mapbox's raw category, or empty) —
    // "Other" preserves it as free text rather than silently dropping it.
    editCuisineSelect.value = cur ? '__other__' : ''
    editCuisineOther.value = cur
  }

  editPriceTier.value = restaurant.value.price_tier ?? ''
  editDescription.value = restaurant.value.description ?? ''
  editLocationLabel.value = restaurant.value.location_label ?? ''
  editWebsite.value = restaurant.value.website ?? ''
  editPhone.value = restaurant.value.phone ?? ''
  editYelpUrl.value = restaurant.value.yelp_url ?? ''
  editTripAdvisorUrl.value = restaurant.value.tripadvisor_url ?? ''
  editCoords.value =
    restaurant.value.latitude != null && restaurant.value.longitude != null
      ? { latitude: restaurant.value.latitude, longitude: restaurant.value.longitude }
      : null

  confirmingDelete.value = false
  editingRestaurant.value = true
}

function cancelEditRestaurant() {
  editingRestaurant.value = false
}

async function saveRestaurant() {
  const cuisine = editCuisineSelect.value === '__other__' ? editCuisineOther.value.trim() || null : editCuisineSelect.value || null
  await powerSync.value.execute(
    `UPDATE restaurants
     SET name = ?, cuisine = ?, price_tier = ?, description = ?, location_label = ?,
         website = ?, phone = ?, yelp_url = ?, tripadvisor_url = ?, latitude = ?, longitude = ?, updated_at = ?
     WHERE id = ?`,
    [
      editName.value.trim(),
      cuisine,
      editPriceTier.value || null,
      editDescription.value.trim() || null,
      editLocationLabel.value.trim() || null,
      editWebsite.value.trim() || null,
      editPhone.value.trim() || null,
      editYelpUrl.value.trim() || null,
      editTripAdvisorUrl.value.trim() || null,
      editCoords.value?.latitude ?? null,
      editCoords.value?.longitude ?? null,
      new Date().toISOString(),
      props.id,
    ],
  )
  editingRestaurant.value = false
}

// --- Photo upload ---
// Fires immediately on file selection, independent of the edit form's Save/
// Cancel — see src/lib/photoUpload.ts. Disabled while offline: the upload
// goes straight to Supabase Storage (PowerSync only syncs structured rows,
// never blobs), so there's nothing to queue for later like every other
// write in this app.
const uploadingPhoto = ref(false)
const photoUploadError = ref<string | null>(null)

async function onPhotoSelected(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  uploadingPhoto.value = true
  photoUploadError.value = null
  try {
    await uploadRestaurantPhoto(powerSync.value, props.id, file)
  } catch (err: any) {
    photoUploadError.value = err.message ?? 'Could not upload photo.'
  } finally {
    uploadingPhoto.value = false
    input.value = ''
  }
}

// --- Delete the restaurant ---
// For when a lookup genuinely can't find a place we know exists and it got
// added wrong, or just to clean up a mistake. Cascades locally (PowerSync's
// local schema has no FK enforcement, unlike Postgres) — children deleted
// before the parent, in upload order, so the sync queue doesn't try to
// delete visits/tags that reference an already-gone restaurant remotely.
const confirmingDelete = ref(false)

async function deleteRestaurant() {
  await powerSync.value.execute(`DELETE FROM tags WHERE visit_id IN (SELECT id FROM visits WHERE restaurant_id = ?)`, [props.id])
  await powerSync.value.execute(`DELETE FROM tags WHERE restaurant_id = ?`, [props.id])
  await powerSync.value.execute(`DELETE FROM visits WHERE restaurant_id = ?`, [props.id])
  await powerSync.value.execute(`DELETE FROM restaurants WHERE id = ?`, [props.id])
  router.push({ name: 'restaurants' })
}
</script>

<template>
  <div v-if="restaurant" class="mx-auto max-w-2xl px-4 py-6">
    <RouterLink :to="{ name: 'restaurants' }" class="text-sm text-zinc-500">
      ← Back
    </RouterLink>

    <div class="flex items-start justify-between gap-2">
      <h1 class="mt-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">{{ restaurant.name }}</h1>
      <button v-if="!editingRestaurant" type="button" class="mt-2 shrink-0 text-xs text-zinc-500 underline" @click="startEditRestaurant">
        Edit
      </button>
    </div>

    <img v-if="restaurant.photo_url" :src="restaurant.photo_url" :alt="restaurant.name ?? ''" class="mt-3 h-48 w-full rounded-xl object-cover" />

    <div class="mt-2 flex items-center gap-2 text-sm">
      <label
        class="cursor-pointer text-zinc-500 underline decoration-dotted"
        :class="{ 'cursor-not-allowed opacity-50': !status.connected || uploadingPhoto }"
      >
        {{ uploadingPhoto ? 'Uploading…' : restaurant.photo_url ? 'Replace photo' : 'Add a photo' }}
        <input type="file" accept="image/*" class="hidden" :disabled="!status.connected || uploadingPhoto" @change="onPhotoSelected" />
      </label>
      <span v-if="!status.connected" class="text-xs text-zinc-400">(needs a connection)</span>
    </div>
    <p v-if="photoUploadError" class="mt-1 text-sm text-red-500">{{ photoUploadError }}</p>

    <template v-if="!editingRestaurant">
      <p class="text-sm text-zinc-500">
        <span v-if="restaurant.cuisine">{{ restaurant.cuisine }} · </span>
        <span v-if="restaurant.price_tier">{{ restaurant.price_tier }}</span>
        <span v-if="distanceText">
          <span v-if="restaurant.cuisine || restaurant.price_tier"> · </span>{{ distanceText }}
        </span>
      </p>
      <p v-if="restaurant.description" class="mt-2 text-sm text-zinc-600 dark:text-zinc-300">{{ restaurant.description }}</p>

      <div class="mt-2 flex flex-wrap items-center gap-2">
        <span
          v-for="tag in restaurantTags"
          :key="tag.id"
          class="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
        >
          {{ tag.label }}
        </span>
        <form class="flex gap-1" @submit.prevent="addTag">
          <input
            v-model="newTag"
            type="text"
            placeholder="+ tag"
            class="w-20 rounded-full border border-zinc-300 px-2 py-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
          />
        </form>
      </div>

      <p v-if="restaurant.location_label" class="mt-2 text-sm text-zinc-500">{{ restaurant.location_label }}</p>

      <div class="mt-3 flex flex-wrap gap-3 text-sm">
        <a v-if="restaurant.website" :href="restaurant.website" target="_blank" rel="noopener" class="text-blue-600 underline">
          Website
        </a>
        <a v-if="restaurant.phone" :href="`tel:${restaurant.phone}`" class="text-blue-600 underline">{{ restaurant.phone }}</a>
        <a :href="googleUrl ?? undefined" target="_blank" rel="noopener" class="text-blue-600 underline">Open in Google Maps</a>
        <a :href="appleUrl ?? undefined" target="_blank" rel="noopener" class="text-blue-600 underline">Open in Apple Maps</a>
        <a :href="yelpLink ?? undefined" target="_blank" rel="noopener" class="text-blue-600 underline">Open in Yelp</a>
        <a :href="tripAdvisorLink ?? undefined" target="_blank" rel="noopener" class="text-blue-600 underline">Open in TripAdvisor</a>
      </div>

      <RestaurantMap class="mt-4" :restaurants="mapPlaces" single-pin />
    </template>

    <div v-else class="mt-3 space-y-3">
      <input v-model="editName" type="text" placeholder="Name" class="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />

      <div class="flex gap-2">
        <select v-model="editCuisineSelect" class="flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900">
          <option value="">No cuisine set</option>
          <option v-for="c in CUISINE_OPTIONS" :key="c" :value="c">{{ c }}</option>
          <option value="__other__">Other…</option>
        </select>
        <input
          v-if="editCuisineSelect === '__other__'"
          v-model="editCuisineOther"
          type="text"
          placeholder="Type it in"
          class="flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
      </div>

      <select v-model="editPriceTier" class="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900">
        <option value="">No price set</option>
        <option value="$">$</option>
        <option value="$$">$$</option>
        <option value="$$$">$$$</option>
      </select>

      <textarea
        v-model="editDescription"
        rows="3"
        placeholder="About this place — what makes it worth remembering…"
        class="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
      />

      <input
        v-model="editLocationLabel"
        type="text"
        placeholder="Address"
        class="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
      />

      <LocationPicker v-model="editCoords" />

      <input
        v-model="editWebsite"
        type="text"
        placeholder="Website URL"
        class="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
      />
      <input
        v-model="editPhone"
        type="text"
        placeholder="Phone"
        class="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
      />

      <!-- The generated search links (see lib/geo/location.ts) don't always
           land on the right page — these override them when set. -->
      <input
        v-model="editYelpUrl"
        type="text"
        placeholder="Yelp URL (optional — overrides the search link)"
        class="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
      />
      <input
        v-model="editTripAdvisorUrl"
        type="text"
        placeholder="TripAdvisor URL (optional — overrides the search link)"
        class="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
      />

      <div class="flex gap-2">
        <button type="button" class="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-50 dark:text-zinc-900" @click="saveRestaurant">
          Save
        </button>
        <button type="button" class="rounded-lg px-4 py-2 text-sm text-zinc-500" @click="cancelEditRestaurant">Cancel</button>
      </div>

      <div class="rounded-lg border border-red-200 p-3 dark:border-red-900/50">
        <div v-if="!confirmingDelete">
          <button type="button" class="text-sm text-red-600 underline" @click="confirmingDelete = true">Delete this restaurant</button>
        </div>
        <div v-else class="text-sm">
          <p class="text-red-700 dark:text-red-400">
            Delete "{{ restaurant.name }}" and its {{ visits.length }} visit{{ visits.length === 1 ? '' : 's' }}? This can't be undone from here.
          </p>
          <div class="mt-2 flex gap-2">
            <button type="button" class="rounded-lg bg-red-600 px-3 py-1.5 text-white" @click="deleteRestaurant">Yes, delete</button>
            <button type="button" class="rounded-lg px-3 py-1.5 text-zinc-500" @click="confirmingDelete = false">Cancel</button>
          </div>
        </div>
      </div>
    </div>

    <section class="mt-6 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <h2 class="mb-3 text-sm font-medium text-zinc-900 dark:text-zinc-50">Log a visit</h2>
      <form class="space-y-3" @submit.prevent="logVisit">
        <input v-model="visitDate" type="date" class="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
        <input
          v-model="itemsOrdered"
          type="text"
          placeholder="What did we order?"
          class="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        <div class="flex items-center gap-2">
          <span class="text-sm text-zinc-500">Rating:</span>
          <StarRating v-model="rating" />
        </div>
        <textarea
          v-model="notes"
          rows="2"
          placeholder="Notes…"
          class="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        <label class="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
          <input v-model="wouldntGoBack" type="checkbox" />
          Wouldn't go back
        </label>
        <button type="submit" class="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-50 dark:text-zinc-900">
          Save visit
        </button>
      </form>
    </section>

    <section class="mt-6">
      <h2 class="mb-3 text-sm font-medium text-zinc-900 dark:text-zinc-50">Visit history</h2>
      <p v-if="visits.length === 0" class="text-sm text-zinc-500">No visits logged yet.</p>
      <ul class="space-y-3">
        <li
          v-for="visit in visits"
          :key="visit.id"
          class="rounded-xl border border-zinc-200 p-3 text-sm dark:border-zinc-800"
        >
          <form v-if="editingVisitId === visit.id" class="space-y-3" @submit.prevent="saveEdit">
            <input v-model="editDate" type="date" class="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
            <input
              v-model="editItems"
              type="text"
              placeholder="What did we order?"
              class="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
            <div class="flex items-center gap-2">
              <span class="text-zinc-500">Rating:</span>
              <StarRating v-model="editRating" />
            </div>
            <textarea
              v-model="editNotes"
              rows="2"
              placeholder="Notes…"
              class="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
            <label class="flex items-center gap-2 text-zinc-600 dark:text-zinc-300">
              <input v-model="editWouldntGoBack" type="checkbox" />
              Wouldn't go back
            </label>
            <div class="flex gap-2">
              <button type="submit" class="rounded-lg bg-zinc-900 px-3 py-1.5 text-white dark:bg-zinc-50 dark:text-zinc-900">
                Save
              </button>
              <button type="button" class="rounded-lg px-3 py-1.5 text-zinc-500" @click="cancelEdit">Cancel</button>
            </div>
          </form>

          <template v-else>
            <div class="flex items-center justify-between">
              <span class="font-medium text-zinc-900 dark:text-zinc-50">{{ visit.visit_date }}</span>
              <div class="flex items-center gap-2">
                <span class="text-amber-400">{{ '★'.repeat(visit.rating ?? 0) }}</span>
                <button type="button" class="text-xs text-zinc-500 underline" @click="startEdit(visit)">Edit</button>
              </div>
            </div>
            <p v-if="visit.items_ordered" class="mt-1 text-zinc-600 dark:text-zinc-300">{{ visit.items_ordered }}</p>
            <p v-if="visit.notes" class="mt-1 text-zinc-500">{{ visit.notes }}</p>
            <p v-if="visit.wouldnt_go_back" class="mt-1 font-medium text-red-500">Wouldn't go back</p>
          </template>
        </li>
      </ul>
    </section>
  </div>
  <div v-else class="mx-auto max-w-2xl px-4 py-6 text-sm text-zinc-500">Restaurant not found.</div>
</template>
