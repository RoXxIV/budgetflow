// Formatage monétaire français : espaces fines insécables (U+202F) avant le € et
// comme séparateur de milliers (refonte-ui-budgetflow.md §4.4).
const nf = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export const eur = (v) => nf.format(v ?? 0).replace(/ /g, ' ')
