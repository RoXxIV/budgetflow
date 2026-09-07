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
import { TOUR_STEPS, TOUR_END } from '@/lib/tour.js'

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

// ─── Première utilisation : le guide de configuration, puis la visite des onglets ───
// L'état est relu à chaque navigation tant que les deux ne sont pas derrière nous —
// fermer l'app en cours de route et la rouvrir reprend au bon endroit. Ensuite le
// drapeau local coupe court : plus un seul appel à l'API par navigation.
let settled = false

router.beforeEach(async (to) => {
  if (settled) return true
  const state = await refreshOnboarding()
  if (!state) return true // backend injoignable : ne pas enfermer l'utilisateur

  // 1. Le guide de configuration : rien d'autre à faire tant qu'il n'est pas terminé
  if (state.needsOnboarding) {
    if (to.path === '/bienvenue') return true
    // Sauf le budget type : le guide y envoie pour profiter de toutes ses options
    // (jour de prélèvement, périodicité, compte…). La page s'ouvre dès qu'elle a des
    // catégories à afficher — sans elles, elle ne montre aucun registre.
    if (to.path === '/template' && state.hasCategories) return true
    return '/bienvenue'
  }

  // 2. La visite des onglets : on n'en sort pas avant la fin
  if (state.needsTour) {
    if (TOUR_STEPS.some((s) => s.path === to.path) || to.path === TOUR_END) return true
    return TOUR_STEPS[0].path
  }

  settled = true
  return true
})

export default router
