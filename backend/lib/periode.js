// Nommer un mois : « 2026-09 » → « Septembre 2026 ».
//
// POURQUOI CE FICHIER EXISTE — `month.service.js` en avait seul l'usage jusqu'au 09/09.
// `budgetLine.service.js` en a besoin à son tour, pour dire à l'utilisateur QUEL mois
// refuse une ligne. Or `month.service` importe déjà `budgetLine.service` : lui rendre
// l'import serait circulaire. Un troisième fichier, que les deux importent, coupe court.
//
// Recopier le tableau des mois dans le second service aurait « marché » aussi — et
// donné deux listes à corriger le jour où l'une change.

export const MONTH_NAMES = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];

/**
 * Le nom lisible d'une période.
 *
 * Les messages d'erreur nomment le mois, jamais sa période : « Septembre 2026 est
 * clôturé » se comprend sans effort, « 2026-09 est clôturé » demande une traduction.
 *
 * @param {string} period La période, 'YYYY-MM'.
 * @returns {string} Par exemple « Septembre 2026 ».
 */
export function monthName(period) {
  const [y, m] = period.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}
