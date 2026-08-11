import { createRouter, createWebHistory } from 'vue-router'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/been-there' },
    {
      path: '/been-there',
      name: 'been-there',
      component: () => import('../views/BeenThereView.vue'),
    },
    {
      path: '/want-to-try',
      name: 'want-to-try',
      component: () => import('../views/WantToTryView.vue'),
    },
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
