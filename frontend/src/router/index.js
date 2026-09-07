import { createRouter, createWebHistory } from 'vue-router'
import AccountsView from '@/views/AccountsView.vue'
import SettingsView from '@/views/SettingsView.vue'
import TemplateView from '@/views/TemplateView.vue'
import MonthView from '@/views/MonthView.vue'
import InvestmentsView from '@/views/InvestmentsView.vue'
import StatsView from '@/views/StatsView.vue'
import SubscriptionsView from '@/views/SubscriptionsView.vue'
import OnboardingView from '@/views/OnboardingView.vue'
import { refreshOnboarding } from '@/lib/onboarding.js'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', redirect: '/mois' },
    // Première utilisation : plein écran, sans barre de navigation
    { path: '/bienvenue', name: 'onboarding', component: OnboardingView },
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

// ─── Première utilisation : tant qu'aucun mois n'existe, l'app n'a rien à montrer ───
// L'état est relu dans la base tant que le flux n'est pas terminé, jamais mémorisé :
// fermer l'app en cours de route et la rouvrir reprend à la bonne étape.
let onboardingDone = false
router.beforeEach(async (to) => {
  if (onboardingDone) return true
  const state = await refreshOnboarding()
  if (!state) return true // backend injoignable : ne pas enfermer l'utilisateur
  if (!state.needsOnboarding) { onboardingDone = true; return true }
  if (to.path === '/bienvenue') return true
  // Le guide envoie construire le budget type dans la vraie page Template, avec toutes
  // ses options : elle s'ouvre dès que des catégories existent (sans elles, elle est vide).
  if (to.path === '/template' && state.hasCategories) return true
  return '/bienvenue'
})

export default router
