import { createRouter, createWebHistory } from 'vue-router'
import { authReady, supabaseConnector } from '../lib/powersync/plugin'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/restaurants' },
    {
      path: '/restaurants',
      name: 'restaurants',
      component: () => import('../views/RestaurantsView.vue'),
    },
    // Old pages/flows — kept as redirects in case any were bookmarked.
    // "Log a visit" is no longer its own page: adding a restaurant now
    // navigates straight to its detail page, which already has a full
    // "Log a visit" form. See src/views/RestaurantsView.vue's onPick().
    { path: '/been-there', redirect: '/restaurants' },
    { path: '/want-to-try', redirect: '/restaurants' },
    { path: '/log-visit', redirect: '/restaurants' },
    {
      path: '/restaurants/:id',
      name: 'restaurant-detail',
      component: () => import('../views/RestaurantDetailView.vue'),
      props: true,
    },
    {
      path: '/login',
      name: 'login',
      component: () => import('../views/LoginView.vue'),
    },
  ],
})

// No data without a session, and no workaround via direct navigation — the
// login page is the only allowlisted route. Runs BEFORE the destination is
// confirmed, so a protected component never mounts (and never fires a
// query) while unauthenticated; there's no render-then-redirect flash to
// exploit. `authReady` is awaited once per page load (subsequent
// navigations resolve instantly since it's already settled) — see
// src/lib/powersync/plugin.ts for why the timing matters on a hard reload.
router.beforeEach(async (to) => {
  if (to.name === 'login') return true
  await authReady
  if (!supabaseConnector.currentSession) return { name: 'login' }
  return true
})
