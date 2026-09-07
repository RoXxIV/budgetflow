// Visite guidée des onglets, jouée une fois le guide de configuration terminé.
//
// L'étape courante n'est pas stockée : c'est la route affichée qui la donne.
// Un rafraîchissement au milieu de la visite reprend donc là où on en était,
// sans état à tenir à jour ni à resynchroniser.
export const TOUR_STEPS = [
  {
    path: '/comptes',
    title: 'Tes comptes, et ce que tu mets de côté',
    body: `Chaque compte porte un solde que tu tiens à jour de mois en mois. À l'intérieur, tu réserves de l'argent dans des enveloppes : un voyage, un matelas de sécurité, une facture annuelle. L'argent ne bouge pas de la banque, il est simplement mis de côté dans tes comptes.`,
  },
  {
    path: '/template',
    title: 'Ton budget type',
    body: `C'est le mois modèle : chaque nouveau mois en est recopié. Tu y règles ce qui revient — le jour du prélèvement, la périodicité, le compte débité. Une dépense annuelle peut même être lissée sur douze mois dans une enveloppe.`,
  },
  {
    path: '/parametres',
    title: 'Tes réglages',
    body: `Catégories, thèmes, moyens de paiement, taux d'épargne visé : tout ce qui structure l'app se règle ici. C'est aussi là que tu reviendras compléter ce que tu viens de créer.`,
  },
  {
    path: '/investissements',
    title: 'Ton épargne qui travaille',
    body: `PEA, crypto, assurance-vie : tu saisis ce que tu as investi et la valeur du moment. L'écart entre les deux, c'est ta plus ou moins-value, et le tout entre dans ton patrimoine.`,
  },
  {
    path: '/stats',
    title: 'Le recul sur tes mois',
    body: `Quand quelques mois seront remplis, tu retrouveras ici l'évolution de tes dépenses, de ton épargne et de ton patrimoine — par catégorie, par thème, mois après mois.`,
  },
]

// La visite se termine en rendant la main sur la page Mois
export const TOUR_END = '/mois'

/**
 * Position d'une route dans la visite.
 *
 * C'est ce qui permet à TourGuide de ne rien mémoriser : la route affichée dit à
 * quelle étape on en est.
 *
 * @param {string} path Le chemin de la route courante.
 * @returns {number} L'indice de l'étape, ou -1 si la route n'en fait pas partie.
 */
export const tourIndexOf = (path) => TOUR_STEPS.findIndex((s) => s.path === path)
