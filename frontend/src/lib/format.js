// Formatage monétaire français : espaces fines insécables (U+202F) avant le € et
// comme séparateur de milliers (refonte-ui-budgetflow.md §4.4).
const nf = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/**
 * Met un montant en euros au format français.
 *
 * Intl produit une espace insécable ordinaire (U+00A0) ; on la remplace par une
 * espace fine insécable (U+202F), plus serrée, qui est la convention typographique
 * française pour les milliers et devant le symbole. Un montant absent vaut 0 plutôt
 * que d'afficher « NaN € ».
 *
 * @param {number|null|undefined} v Le montant en euros.
 * @returns {string} Le montant formaté, par exemple « 1 234,50 € ».
 */
export const eur = (v) => nf.format(v ?? 0).replace(/ /g, ' ')
