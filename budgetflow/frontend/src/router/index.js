import { createRouter, createWebHistory } from 'vue-router'
import AccountsView from '@/views/AccountsView.vue'
import SettingsView from '@/views/SettingsView.vue'
import TemplateView from '@/views/TemplateView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', redirect: '/comptes' },
    { path: '/comptes', name: 'accounts', component: AccountsView },
    { path: '/template', name: 'template', component: TemplateView },
    { path: '/parametres', name: 'settings', component: SettingsView },
  ],
})

export default router
