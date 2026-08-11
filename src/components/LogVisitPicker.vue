<script setup lang="ts">
// Restaurant picker for "log a visit" — searches restaurants we already
// track (most recently visited first) alongside Mapbox for places we don't
// have yet, so logging a visit for a brand-new spot doesn't require adding
// the restaurant first. See PRD.md follow-up: "just be able to do it from
// the new visit option."
import { onBeforeUnmount, ref } from 'vue'
import { usePowerSync } from '@powersync/vue'
import { newSessionToken, retrievePlace, suggestPlaces, type PlaceSuggestion } from '../lib/mapbox/searchBox'
import type { PickedRestaurant } from '../lib/logVisit'

type ExistingMatch = { id: string; name: string; status: string; last_visit_date: string | null }

const emit = defineEmits<{ pick: [PickedRestaurant] }>()

const powerSync = usePowerSync()

const query = ref('')
const existingMatches = ref<ExistingMatch[]>([])
const placeSuggestions = ref<PlaceSuggestion[]>([])
const open = ref(false)
const searchError = ref<string | null>(null)
let sessionToken = newSessionToken()
let debounceHandle: ReturnType<typeof setTimeout> | undefined

function onInput() {
  searchError.value = null
  clearTimeout(debounceHandle)
  const q = query.value.trim()
  if (q.length < 2) {
    existingMatches.value = []
    placeSuggestions.value = []
    open.value = false
    return
  }
  debounceHandle = setTimeout(async () => {
    const [existing, remote] = await Promise.allSettled([
      // Most-recently-visited match first; never-visited (or want-to-try)
      // matches sort after via SQLite's NULLS-are-smallest ordering.
      powerSync.value.getAll<ExistingMatch>(
        `SELECT r.id, r.name, r.status, MAX(v.visit_date) as last_visit_date
         FROM restaurants r
         LEFT JOIN visits v ON v.restaurant_id = r.id
         WHERE r.name LIKE ?
         GROUP BY r.id
         ORDER BY last_visit_date DESC
         LIMIT 5`,
        [`%${q}%`],
      ),
      suggestPlaces(q, sessionToken),
    ])

    existingMatches.value = existing.status === 'fulfilled' ? existing.value : []
    if (remote.status === 'fulfilled') {
      placeSuggestions.value = remote.value
    } else {
      placeSuggestions.value = []
      console.warn('Restaurant search failed (offline? missing token?):', remote.reason)
      searchError.value = existingMatches.value.length ? null : 'Live search unavailable — press Enter to add as typed.'
    }
    open.value = true
  }, 300)
}

function pickExisting(m: ExistingMatch) {
  emit('pick', { kind: 'existing', id: m.id, name: m.name, status: m.status })
  reset()
}

async function pickSuggestion(s: PlaceSuggestion) {
  try {
    const place = await retrievePlace(s.mapboxId, sessionToken)
    if (place) emit('pick', { kind: 'new', place })
    else emit('pick', { kind: 'manual', name: s.name })
  } catch (e) {
    console.warn('Could not fetch place details, falling back to manual entry:', e)
    emit('pick', { kind: 'manual', name: s.name })
  }
  reset()
}

function submitManual() {
  const name = query.value.trim()
  if (!name) return
  emit('pick', { kind: 'manual', name })
  reset()
}

function reset() {
  existingMatches.value = []
  placeSuggestions.value = []
  open.value = false
  query.value = ''
  sessionToken = newSessionToken()
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && existingMatches.value.length === 0 && placeSuggestions.value.length === 0) {
    e.preventDefault()
    submitManual()
  } else if (e.key === 'Escape') {
    open.value = false
  }
}

function onBlur() {
  setTimeout(() => (open.value = false), 150)
}

onBeforeUnmount(() => clearTimeout(debounceHandle))
</script>

<template>
  <div class="relative">
    <input
      v-model="query"
      type="text"
      placeholder="Restaurant name…"
      class="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
      @input="onInput"
      @keydown="onKeydown"
      @focus="open = existingMatches.length > 0 || placeSuggestions.length > 0"
      @blur="onBlur"
    />

    <ul
      v-if="open"
      class="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-zinc-200 bg-white text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
    >
      <template v-if="existingMatches.length">
        <li class="bg-zinc-50 px-3 py-1 text-xs font-medium text-zinc-400 dark:bg-zinc-800/50">Your restaurants</li>
        <li
          v-for="m in existingMatches"
          :key="m.id"
          class="cursor-pointer px-3 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          @mousedown.prevent="pickExisting(m)"
        >
          <div class="text-zinc-900 dark:text-zinc-50">{{ m.name }}</div>
          <div class="text-xs text-zinc-500">
            {{ m.last_visit_date ? `Last visited ${m.last_visit_date}` : m.status === 'want_to_try' ? 'Want to try — no visits yet' : 'No visits yet' }}
          </div>
        </li>
      </template>

      <template v-if="placeSuggestions.length">
        <li class="bg-zinc-50 px-3 py-1 text-xs font-medium text-zinc-400 dark:bg-zinc-800/50">Search results</li>
        <li
          v-for="s in placeSuggestions"
          :key="s.mapboxId"
          class="cursor-pointer px-3 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          @mousedown.prevent="pickSuggestion(s)"
        >
          <div class="text-zinc-900 dark:text-zinc-50">{{ s.name }}</div>
          <div class="text-xs text-zinc-500">{{ s.fullAddress }}</div>
        </li>
      </template>

      <li v-if="searchError" class="px-3 py-2 text-zinc-500">{{ searchError }}</li>

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
