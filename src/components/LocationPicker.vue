<script setup lang="ts">
// Click-to-set coordinates — for fixing/adding a restaurant's location when
// the Mapbox search lookup didn't find it (or found the wrong branch). See
// PRD.md follow-up: "add in the other information, like the coordinates on
// a map."
import { onBeforeUnmount, onMounted, useTemplateRef } from 'vue'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { getCurrentPosition, type Coordinates } from '../lib/geo/location'

const props = defineProps<{ modelValue: Coordinates | null }>()
const emit = defineEmits<{ 'update:modelValue': [Coordinates] }>()

const containerRef = useTemplateRef<HTMLDivElement>('container')
let map: mapboxgl.Map | null = null
let marker: mapboxgl.Marker | null = null

function placeMarker(coords: Coordinates, recenter: boolean) {
  if (!map) return
  if (!marker) {
    marker = new mapboxgl.Marker({ color: '#18181b', draggable: true })
      .setLngLat([coords.longitude, coords.latitude])
      .addTo(map)
    marker.on('dragend', () => {
      const pos = marker!.getLngLat()
      emit('update:modelValue', { latitude: pos.lat, longitude: pos.lng })
    })
  } else {
    marker.setLngLat([coords.longitude, coords.latitude])
  }
  if (recenter) map.setCenter([coords.longitude, coords.latitude])
}

onMounted(() => {
  // Construct the map synchronously, before any await — reading
  // containerRef.value after an await (inside the same onMounted) risked
  // it going stale if anything else re-rendered in that gap (this app has
  // PowerSync's watched queries firing often). Build first with whatever
  // we know synchronously; try to locate the user afterward, operating on
  // the already-built `map` variable rather than the template ref again.
  mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN
  const startAt = props.modelValue ?? { latitude: 43.4712, longitude: -89.7449 }

  map = new mapboxgl.Map({
    container: containerRef.value!,
    style: 'mapbox://styles/mapbox/streets-v12',
    center: [startAt.longitude, startAt.latitude],
    zoom: props.modelValue ? 14 : 11,
  })
  map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')

  if (props.modelValue) placeMarker(props.modelValue, false)

  map.on('click', (e) => {
    const coords = { latitude: e.lngLat.lat, longitude: e.lngLat.lng }
    placeMarker(coords, false)
    emit('update:modelValue', coords)
  })

  if (!props.modelValue) {
    getCurrentPosition()
      .then((here) => map?.setCenter([here.longitude, here.latitude]))
      .catch(() => {}) // no location yet — the WI fallback view is fine
  }
})

onBeforeUnmount(() => {
  marker?.remove()
  map?.remove()
})
</script>

<template>
  <div>
    <div ref="container" class="h-56 w-full rounded-xl" />
    <p class="mt-1 text-xs text-zinc-500">
      {{ modelValue ? 'Drag the pin or click elsewhere to move it.' : 'Click the map to set this place\'s location.' }}
    </p>
  </div>
</template>
