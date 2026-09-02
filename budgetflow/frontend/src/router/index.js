import { createRouter, createWebHistory } from 'vue-router'
import AccountsView from '@/views/AccountsView.vue'
import SettingsView from '@/views/SettingsView.vue'
import TemplateView from '@/views/TemplateView.vue'
import MonthView from '@/views/MonthView.vue'
import InvestmentsView from '@/views/InvestmentsView.vue'
import StatsView from '@/views/StatsView.vue'

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
  ],
})

export default router
