<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

// Two known users (Dorn and Sara) sign in with Supabase email/password auth —
// see PRD.md "Who uses it". No self-serve signup; create the two accounts
// once in the Supabase dashboard (Authentication > Users).
const auth = useAuthStore()
const router = useRouter()

const email = ref('')
const password = ref('')
const error = ref<string | null>(null)
const submitting = ref(false)

async function submit() {
  submitting.value = true
  error.value = null
  try {
    await auth.login(email.value, password.value)
    router.push({ name: 'been-there' })
  } catch (e: any) {
    error.value = e.message ?? 'Could not sign in.'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-sm px-4 py-16">
    <h1 class="mb-6 text-xl font-semibold text-zinc-900 dark:text-zinc-50">Sign in</h1>
    <form class="space-y-3" @submit.prevent="submit">
      <input
        v-model="email"
        type="email"
        placeholder="Email"
        autocomplete="username"
        class="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
      />
      <input
        v-model="password"
        type="password"
        placeholder="Password"
        autocomplete="current-password"
        class="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
      />
      <button
        type="submit"
        :disabled="submitting"
        class="w-full rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
      >
        {{ submitting ? 'Signing in…' : 'Sign in' }}
      </button>
      <p v-if="error" class="text-sm text-red-500">{{ error }}</p>
    </form>
  </div>
</template>
