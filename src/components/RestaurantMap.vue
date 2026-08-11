<script setup lang="ts">
// Interactive map view — the alternative to the card list on the browsing
// pages (see PRD.md follow-up), and the single-pin location view on a
// restaurant's detail page.
//
// Self-locates and frames a ~10mi default view around the user, Yelp/
// Zillow-style — but that's just the STARTING view, never a hard limit:
// pins for everything passed in always exist on the map regardless of the
// current viewport, and "Search this area" only re-scopes the mini-list
// below, on request. See PRD.md follow-up: "I don't [mean t]o limit them...
// I could zoom into an area and just filter it."
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import { useRouter } from 'vue-router'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { boundingBoxMiles, getCurrentPosition, type Coordinates } from '../lib/geo/location'
import { ratingMarkerHex } from '../lib/ratingColor'

export type MappablePlace = {
  id: string
  name: string
  latitude: number | null
  longitude: number | null
  price_tier?: string | null
  avg_rating?: number | null
  /** Most recent visit was flagged "wouldn't go back" — see
   * src/lib/ratingColor.ts. Renders as a distinct muted marker, outside the
   * rating color scale entirely. */
  wouldntGoBack?: boolean
}

const props = defineProps<{
  restaurants: MappablePlace[]
  here?: Coordinates | null
}>()

const DEFAULT_RADIUS_MILES = 10

const router = useRouter()
const containerRef = useTemplateRef<HTMLDivElement>('container')
let map: mapboxgl.Map | null = null
const markersById = new Map<string, mapboxgl.Marker>()
let hereMarker: mapboxgl.Marker | null = null
let suppressNextMoveEnd = false

function located(r: MappablePlace): r is MappablePlace & { latitude: number; longitude: number } {
  return r.latitude != null && r.longitude != null
}

const hasLocatedRestaurants = computed(() => props.restaurants.some(located))

// --- Self-location ---
// Unlike the list views (where "Nearest" is an opt-in click), the map's
// whole framing depends on knowing where the user is, so it asks on its
// own rather than starting centered on nothing in particular.
const ownHere = ref<Coordinates | null>(null)
const locating = ref(false)
const locationError = ref<string | null>(null)
const effectiveHere = computed(() => props.here ?? ownHere.value)

async function locateSelf() {
  if (effectiveHere.value) return
  locating.value = true
  locationError.value = null
  try {
    ownHere.value = await getCurrentPosition()
  } catch (e: any) {
    locationError.value = e.message ?? 'Could not get your location.'
  } finally {
    locating.value = false
  }
}

// --- "Search this area" ---
// null = no area scope active (mini-list shows everything passed in).
const areaFilterIds = ref<Set<string> | null>(null)
const boundsMoved = ref(false)

function applyAreaFilter() {
  if (!map) return
  const bounds = map.getBounds()
  if (!bounds) return
  const ids = new Set(
    props.restaurants
      .filter(located)
      .filter((r) => bounds.contains([r.longitude, r.latitude]))
      .map((r) => r.id),
  )
  areaFilterIds.value = ids
  boundsMoved.value = false
}

function clearAreaFilter() {
  areaFilterIds.value = null
  boundsMoved.value = false
}

const displayedRestaurants = computed(() => {
  const list = props.restaurants.filter(located)
  if (!areaFilterIds.value) return list
  return list.filter((r) => areaFilterIds.value!.has(r.id))
})

// --- Markers ---
function renderMarkers() {
  if (!map) return
  // The container may have been display:none at mount time (e.g. while
  // restaurants was still loading, via the v-show below) — Mapbox sizes its
  // canvas from the container at creation, so re-measure before fitting.
  map.resize()
  markersById.forEach((m) => m.remove())
  markersById.clear()
  hereMarker?.remove()
  hereMarker = null

  for (const r of props.restaurants.filter(located)) {
    const popupNode = document.createElement('div')
    popupNode.className = 'text-sm'
    popupNode.innerHTML = `
      <div class="font-medium">${escapeHtml(r.name)}</div>
      <div class="text-zinc-500">
        ${r.wouldntGoBack ? "Wouldn't go back" : r.avg_rating != null ? '★'.repeat(Math.round(r.avg_rating)) + ' · ' : ''}${r.price_tier ?? ''}
      </div>
      <a href="#" class="text-blue-600 underline" data-view-restaurant>View details</a>
    `
    popupNode.querySelector('[data-view-restaurant]')?.addEventListener('click', (e) => {
      e.preventDefault()
      router.push({ name: 'restaurant-detail', params: { id: r.id } })
    })

    const marker = new mapboxgl.Marker({ color: ratingMarkerHex(r.avg_rating, r.wouldntGoBack) })
      .setLngLat([r.longitude, r.latitude])
      .setPopup(new mapboxgl.Popup({ offset: 24 }).setDOMContent(popupNode))
      .addTo(map)
    markersById.set(r.id, marker)
  }

  if (effectiveHere.value) {
    hereMarker = new mapboxgl.Marker({ color: '#2563eb' })
      .setLngLat([effectiveHere.value.longitude, effectiveHere.value.latitude])
      .addTo(map)
  }
}

/** Runs once when the map first loads: places markers, finds the user (if
 * not already known), and frames the initial ~10mi view around them —
 * falling back to fitting whatever restaurants exist if location isn't
 * available. */
async function setupInitialView() {
  if (!map) return
  renderMarkers()
  await locateSelf()
  // The component may have been torn down (e.g. navigated away) while that
  // await was pending — map?.remove() runs in onBeforeUnmount, but without
  // this check we'd still call .fitBounds()/.resize() on the now-destroyed
  // instance once the await resolves, which throws deep inside Mapbox GL.
  if (!map) return
  if (effectiveHere.value) {
    renderMarkers() // re-render so the "here" dot appears
    const box = boundingBoxMiles(effectiveHere.value, DEFAULT_RADIUS_MILES)
    suppressNextMoveEnd = true
    map.fitBounds(
      [
        [box.west, box.south],
        [box.east, box.north],
      ],
      { padding: 32, duration: 0 },
    )
    applyAreaFilter() // default view starts scoped to "near me"
  } else {
    const bounds = new mapboxgl.LngLatBounds()
    props.restaurants.filter(located).forEach((r) => bounds.extend([r.longitude, r.latitude]))
    if (!bounds.isEmpty()) {
      suppressNextMoveEnd = true
      map.fitBounds(bounds, { padding: 48, maxZoom: 15, duration: 0 })
    }
  }
}

function highlightMarker(id: string, on: boolean) {
  const el = markersById.get(id)?.getElement()
  if (!el) return
  el.style.transform = on ? el.style.transform.replace(/\s*scale\([^)]*\)/, '') + ' scale(1.6)' : el.style.transform.replace(/\s*scale\([^)]*\)/, '')
  el.style.zIndex = on ? '10' : ''
  el.style.transition = 'transform 0.1s ease-out'
}

function escapeHtml(s: string) {
  const div = document.createElement('div')
  div.textContent = s
  return div.innerHTML
}

onMounted(() => {
  mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN
  map = new mapboxgl.Map({
    container: containerRef.value!,
    style: 'mapbox://styles/mapbox/streets-v12',
    center: [-89.7, 43.4], // roughly Dane/Sauk County, WI, until we know better
    zoom: 9,
  })
  map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')

  map.on('moveend', () => {
    if (suppressNextMoveEnd) {
      suppressNextMoveEnd = false
      return
    }
    boundsMoved.value = true
  })

  map.on('load', setupInitialView)
})

watch(
  () => props.restaurants,
  () => {
    renderMarkers()
    if (areaFilterIds.value) applyAreaFilter() // keep the mini-list in sync as data changes
  },
  { deep: true },
)

onBeforeUnmount(() => {
  markersById.forEach((m) => m.remove())
  markersById.clear()
  hereMarker?.remove()
  hereMarker = null
  map?.remove()
  // Every guard above (renderMarkers, setupInitialView, applyAreaFilter) is
  // `if (!map) return` — .remove() alone doesn't null the variable, so a
  // late-arriving async callback would still see a truthy (but destroyed)
  // map and crash trying to use it. This is the actual fix; the extra check
  // in setupInitialView just narrows exactly where that used to happen.
  map = null
})
</script>

<template>
  <!-- Single root, not a v-if/v-show sibling fragment — a fragment root
       can't auto-inherit attrs like the `class="mt-4"` callers pass in
       (Vue silently drops them and warns).
       The map container below is v-show, NEVER v-if — onMounted binds
       containerRef unconditionally, so it must always exist in the DOM.
       (v-if here previously crashed the mount whenever a restaurant/list
       had no coordinates yet, since the container div wouldn't exist for
       Mapbox to attach to.) -->
  <div>
    <div v-show="!hasLocatedRestaurants" class="flex h-64 items-center justify-center rounded-xl border border-zinc-200 text-sm text-zinc-500 dark:border-zinc-800">
      Nothing with a location yet.
    </div>

    <div v-show="hasLocatedRestaurants">
      <div class="relative">
        <div ref="container" class="h-64 w-full rounded-xl sm:h-96" />

        <button
          v-if="boundsMoved"
          type="button"
          class="absolute top-3 left-1/2 -translate-x-1/2 rounded-full bg-zinc-900 px-4 py-1.5 text-xs font-medium text-white shadow-lg dark:bg-zinc-50 dark:text-zinc-900"
          @click="applyAreaFilter"
        >
          Search this area
        </button>
      </div>

      <div class="mt-2 flex items-center gap-2 text-xs text-zinc-500">
        <span v-if="locating">Finding you…</span>
        <span v-else-if="locationError">{{ locationError }}</span>
        <template v-else-if="areaFilterIds">
          <span>Showing {{ displayedRestaurants.length }} within this view</span>
          <button type="button" class="underline" @click="clearAreaFilter">Show all</button>
        </template>
      </div>

      <!-- Compact linked list — hover highlights the matching pin, click
           opens it, same as tapping the pin itself. See PRD.md follow-up. -->
      <ul class="mt-2 max-h-48 divide-y divide-zinc-100 overflow-y-auto rounded-lg border border-zinc-200 text-sm dark:divide-zinc-800 dark:border-zinc-800">
        <li v-if="displayedRestaurants.length === 0" class="px-3 py-2 text-zinc-500">Nothing in this area.</li>
        <li
          v-for="r in displayedRestaurants"
          :key="r.id"
          class="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-900"
          @mouseenter="highlightMarker(r.id, true)"
          @mouseleave="highlightMarker(r.id, false)"
          @click="router.push({ name: 'restaurant-detail', params: { id: r.id } })"
        >
          <span
            class="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
            :style="{ backgroundColor: ratingMarkerHex(r.avg_rating, r.wouldntGoBack) }"
          />
          <span class="truncate text-zinc-700 dark:text-zinc-300">{{ r.name }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>
