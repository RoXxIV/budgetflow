import { ref, computed } from 'vue'

/**
 * Devise globale de l'app, alimentée par AppSettings.currency.
 * setCurrency() est appelé au démarrage (App.vue) et à la sauvegarde des Paramètres.
 */
const currencyCode = ref('EUR')

const currencySymbol = computed(() => {
  try {
    return (
      new Intl.NumberFormat('fr-FR', { style: 'currency', currency: currencyCode.value })
        .formatToParts(0)
        .find((p) => p.type === 'currency')?.value || currencyCode.value
    )
  } catch {
    return currencyCode.value
  }
})

export function setCurrency(code) {
  if (code) currencyCode.value = code
}

export function useCurrency() {
  return { currencyCode, currencySymbol }
}
