import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '@/views/HomeView.vue'
import SettingsView from '@/views/SettingsView.vue'
import TemplateView from '@/views/TemplateView.vue'
import InvestmentView from '@/views/InvestmentView.vue'
import GoalsView from '@/views/GoalsView.vue'
import SheetView from '@/views/SheetView.vue'
import ArchivesView from '@/views/ArchivesView.vue'
import StatisticsView from '@/views/StatisticsView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', name: 'home', component: HomeView },
    { path: '/parametres', name: 'settings', component: SettingsView },
    { path: '/template', name: 'template', component: TemplateView },
    { path: '/sheet', name: 'sheet', component: SheetView },
    { path: '/investissements', name: 'investments', component: InvestmentView },
    { path: '/objectifs', name: 'goals', component: GoalsView },
    { path: '/archives', name: 'archives', component: ArchivesView },
    { path: '/statistiques', name: 'statistics', component: StatisticsView },
  ],
})

export default router
