import { createRouter, createWebHistory } from 'vue-router'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/restaurants' },
    {
      path: '/restaurants',
      name: 'restaurants',
      component: () => import('../views/RestaurantsView.vue'),
    },
    // Old two-page split — kept as redirects in case either was bookmarked.
    { path: '/been-there', redirect: '/restaurants' },
    { path: '/want-to-try', redirect: '/restaurants' },
    {
      path: '/log-visit',
      name: 'log-visit',
      component: () => import('../views/LogVisitView.vue'),
    },
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
