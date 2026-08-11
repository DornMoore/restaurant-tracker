import { defineStore } from 'pinia'

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'restaurant-tracker:theme'

// Respects the OS setting until you explicitly choose — then remembers
// your choice. The no-flash inline script in index.html does this same
// resolution synchronously before first paint; this mirrors it so the
// store's reactive state matches what's already on the page.
function resolveInitialTheme(): Theme {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved === 'light' || saved === 'dark') return saved
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export const useThemeStore = defineStore('theme', {
  state: () => ({
    theme: resolveInitialTheme() as Theme,
  }),
  actions: {
    /** Call once on app mount — re-applies the class for consistency (the
     * inline script in index.html already set it before first paint). */
    init() {
      this.apply()
    },
    toggle() {
      this.theme = this.theme === 'dark' ? 'light' : 'dark'
      localStorage.setItem(STORAGE_KEY, this.theme)
      this.apply()
    },
    apply() {
      document.documentElement.classList.toggle('dark', this.theme === 'dark')
    },
  },
})
