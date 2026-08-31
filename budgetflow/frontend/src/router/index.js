import { createRouter, createWebHistory } from 'vue-router'
import AccountsView from '@/views/AccountsView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    // Premier écran du squelette : comptes & enveloppes. Le reste viendra s'ajouter ici.
    { path: '/', redirect: '/comptes' },
    { path: '/comptes', name: 'accounts', component: AccountsView },
  ],
})

export default router
