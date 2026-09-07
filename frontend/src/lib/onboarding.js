// État de la première utilisation, partagé entre le garde de routage, la barre
// d'application et l'écran d'accueil — pour ne pas interroger l'API trois fois.
// Il est relu à chaque navigation tant que le flux n'est pas terminé : c'est la base
// qui fait foi, jamais un drapeau mémorisé (fermer l'app en cours de route et la
// rouvrir doit reprendre à la bonne étape).
import { ref } from 'vue'
import { getOnboarding } from '@/api/settings.js'

// Dernier état connu ; null tant qu'aucune lecture n'a abouti
export const onboarding = ref(null)

/**
 * Relit l'état du guide auprès du serveur et le publie à toute l'application.
 *
 * Appelée par le garde de routage à chaque navigation tant que le parcours n'est pas
 * fini. En cas d'échec, on renvoie null sans toucher à l'état : l'appelant laisse
 * alors passer plutôt que d'enfermer l'utilisateur sur un écran d'accueil qu'il ne
 * pourrait pas franchir.
 *
 * @returns {Promise<object|null>} L'état renvoyé par l'API, ou null si injoignable.
 */
export async function refreshOnboarding() {
  try {
    const { data } = await getOnboarding()
    onboarding.value = data
    return data
  } catch {
    return null
  }
}

/**
 * Traduit l'étape courante en position, pour afficher « étape 3 sur 4 ».
 *
 * Le rang vient de la liste d'étapes renvoyée par le serveur, jamais d'un compteur
 * local : ajouter une étape côté back suffit à corriger l'affichage.
 *
 * @param {object|null} state L'état d'onboarding.
 * @returns {{current: number, total: number}|null} La position, ou null hors parcours.
 */
export function stepNumber(state) {
  if (!state?.step || !state.steps) return null
  const i = state.steps.indexOf(state.step)
  return i < 0 ? null : { current: i + 1, total: state.steps.length }
}
