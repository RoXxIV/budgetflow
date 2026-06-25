/**
 * Formate un montant en français avec 2 décimales.
 * Utilisé partout dans l'UI pour afficher des sommes.
 * Ex: 1234.5 → "1 234,50"
 */
export function fmt(n) {
  return (n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/**
 * Formate une date ISO en date courte française.
 * Ex: "2026-04-01" → "01/04/2026"
 */
export function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString('fr-FR') : '—'
}

/**
 * Formate un montant avec le symbole € via l'API Intl.
 * Utilisé dans HomeView pour le patrimoine total.
 * Ex: 1234.5 → "1 234,50 €"
 */
export function formatCurrency(amount) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(amount)
}
