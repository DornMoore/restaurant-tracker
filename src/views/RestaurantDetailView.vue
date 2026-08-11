<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useQuery, usePowerSync, useStatus } from '@powersync/vue'
import { useRoute, useRouter } from 'vue-router'
import LocationPicker from '../components/LocationPicker.vue'
import RestaurantMap from '../components/RestaurantMap.vue'
import StarRating from '../components/StarRating.vue'
import { appleMapsUrl, distanceMiles, getCurrentPosition, googleMapsUrl, type Coordinates } from '../lib/geo/location'
import { drivingInfo } from '../lib/mapbox/directions'
import { CUISINE_OPTIONS } from '../lib/cuisines'
import { REVIEW_SITE_PRESETS } from '../lib/reviewSites'
import { uploadRestaurantPhoto } from '../lib/photoUpload'
import type { RestaurantRecord, VisitRecord, TagRecord, ReviewLinkRecord } from '../lib/powersync/schema'

const props = defineProps<{ id: string }>()
const powerSync = usePowerSync()
const router = useRouter()
const route = useRoute()
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

const { data: visits } = useQuery<VisitRecord>(
  `SELECT * FROM visits WHERE restaurant_id = ? ORDER BY visit_date DESC`,
  [props.id],
)

const { data: restaurantTags } = useQuery<TagRecord>(
  `SELECT * FROM tags WHERE restaurant_id = ?`,
  [props.id],
)

// All distinct tags across every restaurant — small table at this app's
// scale, no pagination needed — powers the "did we already use this tag?"
// autocomplete below, so the same idea doesn't get typed slightly
// differently on different restaurants.
const { data: allTagLabels } = useQuery<{ label: string }>(`SELECT DISTINCT label FROM tags ORDER BY label`)

const { data: reviewLinks } = useQuery<ReviewLinkRecord>(
  `SELECT * FROM review_links WHERE restaurant_id = ? ORDER BY created_at`,
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
const tagSuggestionsOpen = ref(false)

// Existing tags elsewhere, filtered to what's typed so far and excluding
// anything already on THIS restaurant — see PRD.md follow-up ("shouldn't
// double create tags"). Same open/blur-delay dropdown pattern as
// RestaurantSearchInput/LogVisitPicker elsewhere in the app.
const tagSuggestions = computed(() => {
  const q = newTag.value.trim().toLowerCase()
  if (!q) return []
  const already = new Set(restaurantTags.value.map((t) => t.label?.toLowerCase()))
  return allTagLabels.value.filter((t) => t.label.toLowerCase().includes(q) && !already.has(t.label.toLowerCase())).slice(0, 8)
})

async function addTag(labelOverride?: string) {
  const label = (labelOverride ?? newTag.value).trim()
  if (!label) return
  // Guard against creating a near-duplicate on the SAME restaurant (e.g. a
  // double-submit, or typing something already suggested but ignoring the
  // dropdown) — a case-insensitive match is close enough here.
  const already = restaurantTags.value.some((t) => t.label?.toLowerCase() === label.toLowerCase())
  if (!already) {
    await powerSync.value.execute(
      `INSERT INTO tags (id, label, restaurant_id, created_at) VALUES (uuid(), ?, ?, ?)`,
      [label, props.id, new Date().toISOString()],
    )
  }
  newTag.value = ''
  tagSuggestionsOpen.value = false
}

function onTagBlur() {
  setTimeout(() => (tagSuggestionsOpen.value = false), 150)
}

async function deleteTag(id: string) {
  await powerSync.value.execute(`DELETE FROM tags WHERE id = ?`, [id])
}

// --- Edit a tag in place ---
const editingTagId = ref<string | null>(null)
const editingTagLabel = ref('')

function startEditTag(tag: TagRecord) {
  editingTagId.value = tag.id
  editingTagLabel.value = tag.label ?? ''
}

async function saveTagEdit() {
  const label = editingTagLabel.value.trim()
  if (!editingTagId.value || !label) return
  await powerSync.value.execute(`UPDATE tags SET label = ? WHERE id = ?`, [label, editingTagId.value])
  editingTagId.value = null
}

function cancelTagEdit() {
  editingTagId.value = null
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

// A freshly-added restaurant (see RestaurantsView.vue's onPick()) lands
// here with ?new=1 — open straight into the edit form (website/phone/
// review links all visible right away) instead of view mode, where half
// of that is hidden behind a separate "Edit" click and the most prominent
// thing on the page would otherwise be the "Log a visit" form below. Runs
// once, the first time `restaurant` actually has data (it's null/empty
// until the local query resolves) — then drops the query param so a
// reload or shared link doesn't keep forcing edit mode back open.
const stopAutoEditWatch = watch(restaurant, (r) => {
  if (!r) return
  if (route.query.new) {
    startEditRestaurant()
    router.replace({ name: 'restaurant-detail', params: { id: props.id } })
  }
  stopAutoEditWatch()
})

async function saveRestaurant() {
  const cuisine = editCuisineSelect.value === '__other__' ? editCuisineOther.value.trim() || null : editCuisineSelect.value || null
  await powerSync.value.execute(
    `UPDATE restaurants
     SET name = ?, cuisine = ?, price_tier = ?, description = ?, location_label = ?,
         website = ?, phone = ?, latitude = ?, longitude = ?, updated_at = ?
     WHERE id = ?`,
    [
      editName.value.trim(),
      cuisine,
      editPriceTier.value || null,
      editDescription.value.trim() || null,
      editLocationLabel.value.trim() || null,
      editWebsite.value.trim() || null,
      editPhone.value.trim() || null,
      editCoords.value?.latitude ?? null,
      editCoords.value?.longitude ?? null,
      new Date().toISOString(),
      props.id,
    ],
  )
  editingRestaurant.value = false
}

// --- Review links (generalizes the old fixed Yelp/TripAdvisor fields) ---
// Independent add/edit/delete, same "fires immediately, not gated behind
// the big Save/Cancel" spirit as tags and the photo upload elsewhere in
// this file. See supabase/migrations/0008_review_links.sql.
const newLinkLabelSelect = ref('') // one of REVIEW_SITE_PRESETS, '__other__', or ''
const newLinkLabelOther = ref('')
const newLinkUrl = ref('')
const newLinkError = ref<string | null>(null)

async function addReviewLink() {
  const label = newLinkLabelSelect.value === '__other__' ? newLinkLabelOther.value.trim() : newLinkLabelSelect.value
  const url = newLinkUrl.value.trim()
  // Pasting just the URL without picking a site from the dropdown (still
  // on its blank "Review site…" placeholder) used to silently do nothing
  // — same silent-no-op pattern as the earlier add-restaurant bug. Now
  // surfaces an actual message instead of failing invisibly.
  if (!label || !url) {
    newLinkError.value = !label ? 'Pick a review site first.' : 'Paste a link too.'
    return
  }
  newLinkError.value = null
  await powerSync.value.execute(
    `INSERT INTO review_links (id, restaurant_id, label, url, created_at) VALUES (uuid(), ?, ?, ?, ?)`,
    [props.id, label, url, new Date().toISOString()],
  )
  newLinkLabelSelect.value = ''
  newLinkLabelOther.value = ''
  newLinkUrl.value = ''
}

const editingLinkId = ref<string | null>(null)
const editingLinkLabel = ref('')
const editingLinkUrl = ref('')

function startEditReviewLink(link: ReviewLinkRecord) {
  editingLinkId.value = link.id
  editingLinkLabel.value = link.label ?? ''
  editingLinkUrl.value = link.url ?? ''
}

async function saveReviewLinkEdit() {
  const label = editingLinkLabel.value.trim()
  const url = editingLinkUrl.value.trim()
  if (!editingLinkId.value || !label || !url) return
  await powerSync.value.execute(`UPDATE review_links SET label = ?, url = ? WHERE id = ?`, [label, url, editingLinkId.value])
  editingLinkId.value = null
}

function cancelReviewLinkEdit() {
  editingLinkId.value = null
}

async function deleteReviewLink(id: string) {
  await powerSync.value.execute(`DELETE FROM review_links WHERE id = ?`, [id])
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

    <!-- Review links — independent add/edit/delete, visible in both view
         and edit mode (unlike the fields below, which are gated behind
         Edit). Any site, any number — nothing shows until you add one;
         see supabase/migrations/0008_review_links.sql. -->
    <div class="mt-3">
      <div v-if="reviewLinks.length" class="flex flex-wrap items-center gap-2 text-sm">
        <div
          v-for="link in reviewLinks"
          :key="link.id"
          class="flex items-center gap-1 rounded-full border border-zinc-200 px-2 py-0.5 dark:border-zinc-700"
        >
          <template v-if="editingLinkId === link.id">
            <input v-model="editingLinkLabel" type="text" class="w-20 rounded border border-zinc-300 px-1 text-xs dark:border-zinc-700 dark:bg-zinc-900" />
            <input v-model="editingLinkUrl" type="text" class="w-32 rounded border border-zinc-300 px-1 text-xs dark:border-zinc-700 dark:bg-zinc-900" />
            <button type="button" class="text-xs text-blue-600 underline" @click="saveReviewLinkEdit">Save</button>
            <button type="button" class="text-xs text-zinc-500" @click="cancelReviewLinkEdit">Cancel</button>
          </template>
          <template v-else>
            <a :href="link.url ?? undefined" target="_blank" rel="noopener" class="text-blue-600 underline">Open in {{ link.label }}</a>
            <button type="button" class="text-xs text-zinc-400 underline decoration-dotted" @click="startEditReviewLink(link)">Edit</button>
            <button type="button" class="text-zinc-400" title="Remove" @click="deleteReviewLink(link.id)">×</button>
          </template>
        </div>
      </div>

      <form class="mt-2 flex flex-wrap items-center gap-2 text-sm" @submit.prevent="addReviewLink">
        <select v-model="newLinkLabelSelect" class="rounded-lg border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900">
          <option value="">Review site…</option>
          <option v-for="s in REVIEW_SITE_PRESETS" :key="s" :value="s">{{ s }}</option>
          <option value="__other__">Other…</option>
        </select>
        <input
          v-if="newLinkLabelSelect === '__other__'"
          v-model="newLinkLabelOther"
          type="text"
          placeholder="Site name"
          class="w-24 rounded-lg border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
        />
        <input
          v-model="newLinkUrl"
          type="text"
          placeholder="Link URL"
          class="min-w-0 flex-1 rounded-lg border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button type="submit" class="rounded-lg bg-zinc-100 px-3 py-1 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">+ Add</button>
      </form>
      <p v-if="newLinkError" class="mt-1 text-xs text-red-500">{{ newLinkError }}</p>
    </div>

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
          class="flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
        >
          <template v-if="editingTagId === tag.id">
            <input
              v-model="editingTagLabel"
              type="text"
              autofocus
              class="w-16 rounded border border-zinc-300 bg-white px-1 dark:border-zinc-700 dark:bg-zinc-900"
              @keydown.enter.prevent="saveTagEdit"
              @keydown.escape="cancelTagEdit"
              @blur="saveTagEdit"
            />
          </template>
          <template v-else>
            <!-- Click the label to edit it in place; × removes it. -->
            <button type="button" @click="startEditTag(tag)">{{ tag.label }}</button>
            <button type="button" class="text-zinc-400" title="Remove tag" @click="deleteTag(tag.id)">×</button>
          </template>
        </span>

        <div class="relative">
          <form class="flex gap-1" @submit.prevent="addTag()">
            <input
              v-model="newTag"
              type="text"
              placeholder="+ tag"
              class="w-20 rounded-full border border-zinc-300 px-2 py-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
              @input="tagSuggestionsOpen = true"
              @focus="tagSuggestionsOpen = tagSuggestions.length > 0"
              @blur="onTagBlur"
            />
          </form>
          <!-- Existing tags matching what's typed — picking one adds it
               immediately instead of risking a near-duplicate. See PRD.md
               follow-up ("shouldn't double create tags"). -->
          <ul
            v-if="tagSuggestionsOpen && tagSuggestions.length"
            class="absolute z-10 mt-1 w-32 overflow-hidden rounded-lg border border-zinc-200 bg-white text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
          >
            <li
              v-for="s in tagSuggestions"
              :key="s.label"
              class="cursor-pointer px-2 py-1 text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              @mousedown.prevent="addTag(s.label)"
            >
              {{ s.label }}
            </li>
          </ul>
        </div>
      </div>

      <p v-if="restaurant.location_label" class="mt-2 text-sm text-zinc-500">{{ restaurant.location_label }}</p>

      <div class="mt-3 flex flex-wrap gap-3 text-sm">
        <a v-if="restaurant.website" :href="restaurant.website" target="_blank" rel="noopener" class="text-blue-600 underline">
          Website
        </a>
        <a v-if="restaurant.phone" :href="`tel:${restaurant.phone}`" class="text-blue-600 underline">{{ restaurant.phone }}</a>
        <a :href="googleUrl ?? undefined" target="_blank" rel="noopener" class="text-blue-600 underline">Open in Google Maps</a>
        <a :href="appleUrl ?? undefined" target="_blank" rel="noopener" class="text-blue-600 underline">Open in Apple Maps</a>
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

      <!-- Review links (Yelp/TripAdvisor/etc.) live in their own
           always-visible section above, not this form — see the "Review
           links" block near the top of this template. -->

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
