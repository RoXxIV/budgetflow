// État de la première utilisation, partagé entre le garde de routage, la barre
// d'application et l'écran d'accueil — pour ne pas interroger l'API trois fois.
// Il est relu à chaque navigation tant que le flux n'est pas terminé : c'est la base
// qui fait foi, jamais un drapeau mémorisé (fermer l'app en cours de route et la
// rouvrir doit reprendre à la bonne étape).
import { ref } from 'vue'
import { getOnboarding } from '@/api/settings.js'

export const onboarding = ref(null)

export async function refreshOnboarding() {
  try {
    const { data } = await getOnboarding()
    onboarding.value = data
    return data
  } catch {
    // Backend injoignable : on ne sait pas, donc on ne bloque rien
    return null
  }
}

// Numéro de l'étape en cours, pour « étape 3 sur 4 »
export function stepNumber(state) {
  if (!state?.step || !state.steps) return null
  const i = state.steps.indexOf(state.step)
  return i < 0 ? null : { current: i + 1, total: state.steps.length }
}
