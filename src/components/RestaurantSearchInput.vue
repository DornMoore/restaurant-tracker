<script setup lang="ts">
// Autocomplete over Mapbox's POI database, so adding a restaurant means
// picking the real place (right address, right branch of a chain) instead
// of typing a name and hoping it's unambiguous. Always leaves a manual-entry
// escape hatch — search needs network, and not every place is in Mapbox's
// database.
import { onBeforeUnmount, ref } from 'vue'
import { newSessionToken, retrievePlace, suggestPlaces, type PlaceSuggestion, type RetrievedPlace } from '../lib/mapbox/searchBox'

const props = defineProps<{
  placeholder?: string
  proximity?: { latitude: number; longitude: number }
}>()

const emit = defineEmits<{
  select: [place: RetrievedPlace]
  manual: [name: string]
}>()

const query = ref('')
const suggestions = ref<PlaceSuggestion[]>([])
const open = ref(false)
const loading = ref(false)
const activeIndex = ref(-1)
const searchError = ref<string | null>(null)
let sessionToken = newSessionToken()
let debounceHandle: ReturnType<typeof setTimeout> | undefined

function onInput() {
  activeIndex.value = -1
  searchError.value = null
  clearTimeout(debounceHandle)
  const q = query.value
  if (q.trim().length < 2) {
    suggestions.value = []
    open.value = false
    return
  }
  debounceHandle = setTimeout(async () => {
    loading.value = true
    try {
      suggestions.value = await suggestPlaces(q, sessionToken, props.proximity)
      open.value = true
    } catch (e) {
      console.warn('Restaurant search failed (offline? missing token?):', e)
      suggestions.value = []
      searchError.value = "Search unavailable — press Enter to add as typed."
      open.value = true
    } finally {
      loading.value = false
    }
  }, 300)
}

async function choose(suggestion: PlaceSuggestion) {
  try {
    const place = await retrievePlace(suggestion.mapboxId, sessionToken)
    if (place) {
      query.value = place.name
      emit('select', place)
    } else {
      emit('manual', suggestion.name)
    }
  } catch (e) {
    console.warn('Could not fetch place details, falling back to manual entry:', e)
    emit('manual', suggestion.name)
  } finally {
    reset()
  }
}

function submitManual() {
  const name = query.value.trim()
  if (!name) return
  emit('manual', name)
  reset()
}

function reset() {
  suggestions.value = []
  open.value = false
  activeIndex.value = -1
  query.value = ''
  sessionToken = newSessionToken() // each search is its own billing session
}

function onKeydown(e: KeyboardEvent) {
  if (!open.value || suggestions.value.length === 0) {
    if (e.key === 'Enter') submitManual()
    return
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    activeIndex.value = (activeIndex.value + 1) % suggestions.value.length
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    activeIndex.value = (activeIndex.value - 1 + suggestions.value.length) % suggestions.value.length
  } else if (e.key === 'Enter') {
    e.preventDefault()
    if (activeIndex.value >= 0) choose(suggestions.value[activeIndex.value])
    else submitManual()
  } else if (e.key === 'Escape') {
    open.value = false
  }
}

function onBlur() {
  // Delay so a click on a suggestion (which blurs the input first) still
  // registers before the dropdown disappears.
  setTimeout(() => (open.value = false), 150)
}

onBeforeUnmount(() => clearTimeout(debounceHandle))
</script>

<template>
  <div class="relative">
    <input
      v-model="query"
      type="text"
      :placeholder="placeholder ?? 'Search for a restaurant…'"
      class="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
      @input="onInput"
      @keydown="onKeydown"
      @focus="open = suggestions.length > 0"
      @blur="onBlur"
    />

    <ul
      v-if="open"
      class="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-zinc-200 bg-white text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
    >
      <li v-if="searchError" class="px-3 py-2 text-zinc-500">{{ searchError }}</li>
      <li
        v-for="(s, i) in suggestions"
        :key="s.mapboxId"
        class="cursor-pointer px-3 py-2"
        :class="i === activeIndex ? 'bg-zinc-100 dark:bg-zinc-800' : ''"
        @mousedown.prevent="choose(s)"
      >
        <div class="text-zinc-900 dark:text-zinc-50">{{ s.name }}</div>
        <div class="text-xs text-zinc-500">{{ s.fullAddress }}</div>
      </li>
      <li
        v-if="query.trim().length >= 2"
        class="cursor-pointer border-t border-zinc-100 px-3 py-2 text-zinc-500 dark:border-zinc-800"
        @mousedown.prevent="submitManual"
      >
        Can't find it? Add "{{ query.trim() }}" as typed
      </li>
    </ul>
  </div>
</template>
