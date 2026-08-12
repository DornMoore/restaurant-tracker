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
import { BASE_MAP_STYLES, styleForTheme } from '../lib/mapbox/baseStyles'
import { createDotElement } from '../lib/mapbox/dotMarker'
import { restaurantStatus, statusHex } from '../lib/statusColor'
import { useThemeStore } from '../stores/theme'

export type MappablePlace = {
  id: string
  name: string
  latitude: number | null
  longitude: number | null
  price_tier?: string | null
  avg_rating?: number | null
  /** 'want_to_try' | 'been_there' — drives red/white/black marker color via
   * src/lib/statusColor.ts, together with wouldntGoBack. */
  status: string
  /** Most recent visit was flagged "wouldn't go back" — see
   * src/lib/statusColor.ts. Renders as a black marker, hidden by default
   * upstream (the caller filters these out unless shown/searched). */
  wouldntGoBack?: boolean
  photo_url?: string | null
}

const props = defineProps<{
  restaurants: MappablePlace[]
  here?: Coordinates | null
  /** The restaurant detail page's single-pin view: frame on that pin
   * immediately and never move the camera for the user's location once
   * it arrives — just add the dot. See PRD.md follow-up ("it doesn't need
   * to move that around"). The browsing map (unset) keeps the original
   * behavior: frame ~10mi around the user once located. */
  singlePin?: boolean
  /** An active text search upstream overrides viewport-scoping entirely —
   * `restaurants` is already search-filtered by the caller, so every match
   * should show regardless of where the camera happens to be, and the
   * camera should move to fit them instead of the other way around. */
  hasActiveSearch?: boolean
}>()

const DEFAULT_RADIUS_MILES = 10

const router = useRouter()
const containerRef = useTemplateRef<HTMLDivElement>('container')
let map: mapboxgl.Map | null = null
const markersById = new Map<string, mapboxgl.Marker>()
let hereMarker: mapboxgl.Marker | null = null
let suppressNextMoveEnd = false

// Base map style — Navigation Day/Night are the two main basemaps, tied to
// the app's light/dark toggle (see PRD.md follow-up). The picker below
// still allows trying any of the other styles ad hoc, but toggling the
// theme (anywhere in the app, even on a different page) always jumps any
// currently-open map back to whichever nav style matches — that's the
// point of pairing these two specifically.
const themeStore = useThemeStore()
const selectedStyleId = ref(styleForTheme(themeStore.theme).id)

function changeBaseStyle(id: string) {
  const style = BASE_MAP_STYLES.find((s) => s.id === id)
  if (!map || !style) return
  selectedStyleId.value = id
  map.setStyle(style.url) // markers/popups are DOM overlays, not style layers — survive this untouched
}

watch(
  () => themeStore.theme,
  (theme) => changeBaseStyle(styleForTheme(theme).id),
)

function located(r: MappablePlace): r is MappablePlace & { latitude: number; longitude: number } {
  return r.latitude != null && r.longitude != null
}

// The want-to-try status renders as a pure white dot — see statusColor.ts —
// which vanishes against a light basemap (or this list's own white
// background) without a dark outline. Every other status keeps the
// original white ring set in createDotElement.
const WANT_TO_TRY_OUTLINE = '#3f3f46' // zinc-700
function markerBorderColor(r: Pick<MappablePlace, 'status' | 'wouldntGoBack'>): string | undefined {
  return restaurantStatus(r.status, r.wouldntGoBack) === 'want_to_try' ? WANT_TO_TRY_OUTLINE : undefined
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

// --- Viewport scoping (live, not button-triggered) ---
// null = no area scope active (mini-list shows everything passed in).
// Continuously re-scoped to the current viewport as the map pans/zooms
// (see the `move`/`moveend` listeners in onMounted) rather than requiring
// an explicit "Search this area" click.
const areaFilterIds = ref<Set<string> | null>(null)

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
}

function clearAreaFilter() {
  areaFilterIds.value = null
}

/** An active search overrides viewport-scoping entirely: show every match
 * passed in (already search-filtered upstream) and move the camera to fit
 * them, rather than scoping the list to wherever the camera happens to be. */
function fitToResults() {
  if (!map) return
  clearAreaFilter()
  const bounds = new mapboxgl.LngLatBounds()
  props.restaurants.filter(located).forEach((r) => bounds.extend([r.longitude, r.latitude]))
  if (!bounds.isEmpty()) {
    suppressNextMoveEnd = true
    map.fitBounds(bounds, { padding: 48, maxZoom: 15 })
  }
}

/** Simple leading+trailing throttle — good enough for a `move` listener
 * firing every animation frame during a pan/zoom gesture; no need for a
 * dependency here. */
function throttle<Args extends unknown[]>(fn: (...args: Args) => void, waitMs: number): (...args: Args) => void {
  let lastRun = 0
  let pendingHandle: ReturnType<typeof setTimeout> | null = null
  return (...args: Args) => {
    const now = performance.now()
    const remaining = waitMs - (now - lastRun)
    if (remaining <= 0) {
      lastRun = now
      fn(...args)
    } else if (!pendingHandle) {
      pendingHandle = setTimeout(() => {
        pendingHandle = null
        lastRun = performance.now()
        fn(...args)
      }, remaining)
    }
  }
}

const displayedRestaurants = computed(() => {
  const list = props.restaurants.filter(located)
  if (!areaFilterIds.value) return list
  return list.filter((r) => areaFilterIds.value!.has(r.id))
})

// --- Markers ---
// createDotElement lives in lib/mapbox/dotMarker.ts — shared with
// LocationPicker.vue so every map in the app uses the same marker look.

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
    // Mapbox's popup bubble background is hardcoded white (its own CSS,
    // not ours — see mapbox-gl.css .mapboxgl-popup-content) regardless of
    // the app's light/dark theme, and sets no text color of its own. An
    // un-colored element here would inherit whatever the ambient dark-mode
    // text color is (white), landing white-on-white and disappearing
    // entirely — confirmed as the actual bug, not a hypothetical. Every
    // text element below gets an explicit, theme-independent dark color.
    const popupNode = document.createElement('div')
    popupNode.className = 'text-sm text-zinc-900'
    popupNode.innerHTML = `
      ${r.photo_url ? `<img src="${escapeHtml(r.photo_url)}" alt="" class="mb-1.5 h-20 w-full rounded-md object-cover" />` : ''}
      <div class="font-medium text-zinc-900">${escapeHtml(r.name)}</div>
      <div class="text-zinc-500">
        ${r.wouldntGoBack ? "Wouldn't go back" : r.avg_rating != null ? '★'.repeat(Math.round(r.avg_rating)) + ' · ' : r.status === 'want_to_try' ? 'Want to try · ' : ''}${r.price_tier ?? ''}
      </div>
      <a href="#" class="text-blue-600 underline" data-view-restaurant>View details</a>
    `
    popupNode.querySelector('[data-view-restaurant]')?.addEventListener('click', (e) => {
      e.preventDefault()
      router.push({ name: 'restaurant-detail', params: { id: r.id } })
    })

    const marker = new mapboxgl.Marker({
      element: createDotElement(statusHex(r.status, r.wouldntGoBack), { borderColor: markerBorderColor(r) }),
    })
      .setLngLat([r.longitude, r.latitude])
      .setPopup(new mapboxgl.Popup({ offset: 12 }).setDOMContent(popupNode))
      .addTo(map)
    markersById.set(r.id, marker)

    // Hovering the marker directly (as opposed to the mini-list row below)
    // shows a lightweight name-only tooltip — separate from the click
    // popup above, so it doesn't carry the photo/rating/link along too.
    // Removed on click so it doesn't linger underneath the real popup.
    // setDOMContent (not setText) so an explicit text color can be set —
    // see the comment above popupNode: Mapbox's popup background is
    // hardcoded white regardless of theme, and .setText()'s plain text
    // node has no element to attach a color to, so it inherited the
    // ambient dark-mode white text color and disappeared.
    const tooltipNode = document.createElement('div')
    tooltipNode.className = 'text-sm text-zinc-900'
    tooltipNode.textContent = r.name
    const tooltip = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, offset: 10 }).setDOMContent(tooltipNode)
    const markerEl = marker.getElement()
    markerEl.addEventListener('mouseenter', () => {
      if (map) tooltip.setLngLat([r.longitude, r.latitude]).addTo(map)
    })
    markerEl.addEventListener('mouseleave', () => tooltip.remove())
    markerEl.addEventListener('click', () => tooltip.remove())
  }

  if (effectiveHere.value) {
    hereMarker = new mapboxgl.Marker({ element: createDotElement('#2563eb', { size: 16, halo: true }) })
      .setLngLat([effectiveHere.value.longitude, effectiveHere.value.latitude])
      .addTo(map)
  }
}

/** Runs once when the map first loads: places markers and frames on
 * whatever restaurants exist immediately — not waiting on the user's
 * location, which can take a moment — then locates the user and either
 * adds their dot in place (singlePin) or jumps to the ~10mi "near me"
 * default view (browsing). See PRD.md follow-up: the detail page's map
 * shouldn't sit blank/unframed while location is still resolving. */
async function setupInitialView() {
  if (!map) return
  renderMarkers()

  const restaurantBounds = new mapboxgl.LngLatBounds()
  props.restaurants.filter(located).forEach((r) => restaurantBounds.extend([r.longitude, r.latitude]))
  if (!restaurantBounds.isEmpty()) {
    suppressNextMoveEnd = true
    map.fitBounds(restaurantBounds, { padding: 48, maxZoom: 15, duration: 0 })
  }

  await locateSelf()
  // The component may have been torn down (e.g. navigated away) while that
  // await was pending — map?.remove() runs in onBeforeUnmount, but without
  // this check we'd still call .fitBounds()/.resize() on the now-destroyed
  // instance once the await resolves, which throws deep inside Mapbox GL.
  if (!map) return
  renderMarkers() // re-render so the "here" dot appears, once located

  if (!effectiveHere.value) return
  if (props.singlePin) return // camera stays on the restaurant — just the dot appeared

  if (props.hasActiveSearch) {
    fitToResults()
    return
  }

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
}

function highlightMarker(id: string, on: boolean) {
  const marker = markersById.get(id)
  if (!marker) return

  // Targets the inner element createDotElement set aside for this — never
  // the marker's own root, which Mapbox repositions every frame (see the
  // comment in createDotElement for why that distinction matters).
  const inner = marker.getElement().querySelector<HTMLElement>('[data-marker-inner]')
  if (inner) {
    inner.style.transform = on ? 'scale(1.6)' : ''
    inner.style.zIndex = on ? '10' : ''
  }

  // Hovering the mini-list row opens the same popup the marker's own click
  // would — the photo/rating/link content comes along for free since it's
  // the same popup object. Guarded by isOpen() so this stays idempotent
  // regardless of whether a previous click already left it open/closed.
  const popup = marker.getPopup()
  if (!popup) return
  const isOpen = popup.isOpen()
  if (on && !isOpen) marker.togglePopup()
  else if (!on && isOpen) marker.togglePopup()
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
    style: styleForTheme(themeStore.theme).url,
    center: [-89.7, 43.4], // roughly Dane/Sauk County, WI, until we know better
    zoom: 9,
  })
  map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')

  // Live-scoped mini-list: re-applies on every pan/zoom instead of waiting
  // for an explicit "Search this area" click. `move` fires continuously
  // during the gesture (throttled so it isn't recomputing every frame);
  // `moveend` is the authoritative final pass once the camera settles. An
  // active search (see fitToResults) owns the camera instead — skip both.
  const throttledApplyAreaFilter = throttle(() => {
    if (!props.hasActiveSearch) applyAreaFilter()
  }, 200)
  map.on('move', throttledApplyAreaFilter)
  map.on('moveend', () => {
    if (suppressNextMoveEnd) {
      suppressNextMoveEnd = false
      return
    }
    if (!props.hasActiveSearch) applyAreaFilter()
  })

  map.on('load', setupInitialView)
})

watch(
  () => props.restaurants,
  () => {
    renderMarkers()
    if (props.hasActiveSearch) fitToResults()
    else if (areaFilterIds.value) applyAreaFilter() // keep the mini-list in sync as data changes
  },
  { deep: true },
)

watch(
  () => props.hasActiveSearch,
  (active) => {
    if (active) fitToResults()
    else applyAreaFilter()
  },
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
    <div v-show="!hasLocatedRestaurants" class="flex h-64 items-center justify-center rounded-xl border border-zinc-200 text-sm text-zinc-500 dark:text-zinc-300 dark:border-zinc-800">
      Nothing with a location yet.
    </div>

    <div v-show="hasLocatedRestaurants">
      <div class="relative">
        <div ref="container" class="h-64 w-full rounded-xl sm:h-96" />

        <!-- Base map picker — try each style and settle on a default; see
             PRD.md follow-up. Persists across every map in the app. -->
        <select
          :value="selectedStyleId"
          class="absolute top-3 left-3 max-w-[9rem] truncate rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
          @change="changeBaseStyle(($event.target as HTMLSelectElement).value)"
        >
          <option v-for="s in BASE_MAP_STYLES" :key="s.id" :value="s.id">{{ s.label }}</option>
        </select>
      </div>

      <div class="mt-2 flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-300">
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
        <li v-if="displayedRestaurants.length === 0" class="px-3 py-2 text-zinc-500 dark:text-zinc-300">Nothing in this area.</li>
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
            :style="{
              backgroundColor: statusHex(r.status, r.wouldntGoBack),
              border: `1.5px solid ${markerBorderColor(r) ?? 'transparent'}`,
            }"
          />
          <span class="truncate text-zinc-700 dark:text-zinc-300">{{ r.name }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>
