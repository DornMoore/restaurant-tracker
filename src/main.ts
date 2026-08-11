import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './style.css'
import App from './App.vue'
import { router } from './router'
import { powerSyncPlugin } from './lib/powersync/plugin'

createApp(App).use(createPinia()).use(router).use(powerSyncPlugin).mount('#app')
