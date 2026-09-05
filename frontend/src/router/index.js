import { createRouter, createWebHistory } from 'vue-router'
import AccountsView from '@/views/AccountsView.vue'
import SettingsView from '@/views/SettingsView.vue'
import TemplateView from '@/views/TemplateView.vue'
import MonthView from '@/views/MonthView.vue'
import InvestmentsView from '@/views/InvestmentsView.vue'
import StatsView from '@/views/StatsView.vue'
import SubscriptionsView from '@/views/SubscriptionsView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', redirect: '/mois' },
    { path: '/mois', name: 'month', component: MonthView },
    { path: '/comptes', name: 'accounts', component: AccountsView },
    { path: '/investissements', name: 'investments', component: InvestmentsView },
    { path: '/stats', name: 'stats', component: StatsView },
    { path: '/template', name: 'template', component: TemplateView },
    { path: '/parametres', name: 'settings', component: SettingsView },
    // Tracker d'abonnements (bac à sable) — accessible depuis la page Mois, pas dans la nav
    { path: '/abonnements', name: 'subscriptions', component: SubscriptionsView },
  ],
})

export default router
