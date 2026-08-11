import { defineStore } from 'pinia'
import type { Session } from '@supabase/supabase-js'
import { supabaseConnector } from '../lib/powersync/plugin'

export const useAuthStore = defineStore('auth', {
  state: () => ({
    session: null as Session | null,
    ready: false,
  }),
  getters: {
    isLoggedIn: (state) => !!state.session,
    userEmail: (state) => state.session?.user.email ?? null,
  },
  actions: {
    /** Call once on app start (see App.vue) — wires up to connector events. */
    listen() {
      this.session = supabaseConnector.currentSession
      supabaseConnector.registerListener({
        initialized: () => {
          this.ready = true
          this.session = supabaseConnector.currentSession
        },
        sessionStarted: (session) => {
          this.session = session
        },
      })
    },
    async login(email: string, password: string) {
      await supabaseConnector.login(email, password)
    },
    async logout() {
      await supabaseConnector.logout()
      this.session = null
    },
  },
})
