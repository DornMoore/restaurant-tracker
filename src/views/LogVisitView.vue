<script setup lang="ts">
// Log a visit for any restaurant — existing or brand new — in one flow.
// Picking an existing match just adds the visit; picking a new place (via
// Mapbox search or manual entry) creates the restaurant and the visit
// together, so there's no separate "add the restaurant first" step. See
// PRD.md follow-up: "just be able to do it from the new visit option."
import { ref } from 'vue'
import { usePowerSync } from '@powersync/vue'
import { useRouter } from 'vue-router'
import LogVisitPicker from '../components/LogVisitPicker.vue'
import StarRating from '../components/StarRating.vue'
import { categoryLabel } from '../lib/mapbox/searchBox'
import type { PickedRestaurant } from '../lib/logVisit'

const powerSync = usePowerSync()
const router = useRouter()

const picked = ref<PickedRestaurant | null>(null)
const visitDate = ref(new Date().toISOString().slice(0, 10))
const itemsOrdered = ref('')
const rating = ref(0)
const notes = ref('')
const wouldntGoBack = ref(false)
const saving = ref(false)

function onPick(p: PickedRestaurant) {
  picked.value = p
}

function changeRestaurant() {
  picked.value = null
}

async function save() {
  if (!picked.value || saving.value) return
  saving.value = true
  try {
    const now = new Date().toISOString()
    let restaurantId: string

    if (picked.value.kind === 'existing') {
      restaurantId = picked.value.id
      if (picked.value.status === 'want_to_try') {
        await powerSync.value.execute(`UPDATE restaurants SET status = 'been_there', updated_at = ? WHERE id = ?`, [
          now,
          restaurantId,
        ])
      }
    } else if (picked.value.kind === 'new') {
      const place = picked.value.place
      restaurantId = crypto.randomUUID()
      await powerSync.value.execute(
        `INSERT INTO restaurants
           (id, name, cuisine, status, latitude, longitude, location_label, mapbox_id, website, phone, created_at, updated_at)
         VALUES (?, ?, ?, 'been_there', ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          restaurantId,
          place.name,
          categoryLabel(place.category),
          place.latitude,
          place.longitude,
          place.fullAddress,
          place.mapboxId,
          place.website,
          place.phone,
          now,
          now,
        ],
      )
    } else {
      restaurantId = crypto.randomUUID()
      await powerSync.value.execute(
        `INSERT INTO restaurants (id, name, status, created_at, updated_at) VALUES (?, ?, 'been_there', ?, ?)`,
        [restaurantId, picked.value.name, now, now],
      )
    }

    await powerSync.value.execute(
      `INSERT INTO visits
         (id, restaurant_id, visit_date, items_ordered, rating, notes, wouldnt_go_back, created_at, updated_at)
       VALUES (uuid(), ?, ?, ?, ?, ?, ?, ?, ?)`,
      [restaurantId, visitDate.value, itemsOrdered.value, rating.value || null, notes.value, wouldntGoBack.value ? 1 : 0, now, now],
    )

    router.push({ name: 'restaurant-detail', params: { id: restaurantId } })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-2xl px-4 py-6">
    <RouterLink :to="{ name: 'restaurants' }" class="text-sm text-zinc-500">← Back</RouterLink>
    <h1 class="mt-2 mb-4 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Log a visit</h1>

    <div v-if="!picked">
      <LogVisitPicker @pick="onPick" />
    </div>

    <div v-else class="space-y-4">
      <div class="flex items-center justify-between rounded-lg bg-zinc-100 px-3 py-2 text-sm dark:bg-zinc-800">
        <div>
          <span class="font-medium text-zinc-900 dark:text-zinc-50">
            {{ picked.kind === 'existing' ? picked.name : picked.kind === 'new' ? picked.place.name : picked.name }}
          </span>
          <span v-if="picked.kind === 'new'" class="ml-2 text-xs text-zinc-500">new — will be added</span>
          <span v-else-if="picked.kind === 'manual'" class="ml-2 text-xs text-zinc-500">new — added as typed</span>
        </div>
        <button type="button" class="text-xs text-zinc-500 underline" @click="changeRestaurant">Change</button>
      </div>

      <form class="space-y-3" @submit.prevent="save">
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
        <button
          type="submit"
          :disabled="saving"
          class="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
        >
          {{ saving ? 'Saving…' : 'Save visit' }}
        </button>
      </form>
    </div>
  </div>
</template>
