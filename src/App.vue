<script setup lang="ts">
import { onMounted } from 'vue'
import { useStatus } from '@powersync/vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from './stores/auth'
import { useThemeStore } from './stores/theme'
import { initPowerSync } from './lib/powersync/plugin'

const status = useStatus()
const auth = useAuthStore()
const theme = useThemeStore()
const router = useRouter()

async function onLogout() {
  await auth.logout()
  // The router guard only runs on navigation — without this, signing out
  // while already sitting on a protected page wouldn't hide it until the
  // next click. See src/router/index.ts.
  router.push({ name: 'login' })
}

onMounted(async () => {
  theme.init()
  auth.listen()
  // Starts the local DB immediately (works with zero signal) and connects
  // the sync stream in the background — see PRD.md "Platform and
  // architecture". Errors here are almost always "no connection right now",
  // which is expected and not fatal to local use.
  try {
    await initPowerSync()
  } catch (e) {
    console.warn('PowerSync connect failed (will retry when online):', e)
  }
})
</script>

<template>
  <div class="min-h-svh bg-zinc-50 dark:bg-zinc-950">
    <header class="border-b border-zinc-200 dark:border-zinc-800">
      <div class="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
        <!-- No data without a session (see router/index.ts's guard) — nav
             and sync status are chrome, not data, but showing them past a
             hard login gate reads as inconsistent, so they're hidden too
             until signed in. -->
        <nav v-if="auth.isLoggedIn" class="flex gap-4 text-sm font-medium">
          <RouterLink :to="{ name: 'restaurants' }" class="text-zinc-900 dark:text-zinc-50">Restaurants</RouterLink>
        </nav>
        <div class="flex items-center gap-3">
          <!-- Also picks Navigation Day/Night as the basemap on any open
               map — see PRD.md follow-up ("our two main basemaps"). -->
          <button type="button" class="text-xs text-zinc-500 dark:text-zinc-300" :title="theme.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'" @click="theme.toggle()">
            {{ theme.theme === 'dark' ? '🌙' : '☀️' }}
          </button>
          <span
            v-if="auth.isLoggedIn"
            class="text-xs"
            :class="status.connected ? 'text-emerald-600' : 'text-zinc-400'"
            :title="status.getMessage()"
          >
            {{ status.connected ? (status.uploading || status.downloading ? 'Syncing…' : 'Synced') : 'Offline' }}
          </span>
          <RouterLink v-if="!auth.isLoggedIn" :to="{ name: 'login' }" class="text-xs text-zinc-500 dark:text-zinc-300 underline">
            Sign in
          </RouterLink>
          <button v-else type="button" class="text-xs text-zinc-500 dark:text-zinc-300 underline" @click="onLogout">
            Sign out
          </button>
        </div>
      </div>
    </header>
    <RouterView />
  </div>
</template>
