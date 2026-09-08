// Visite guidée des onglets, jouée une fois le guide de configuration terminé.
//
// L'étape courante n'est pas stockée : c'est la route affichée qui la donne.
// Un rafraîchissement au milieu de la visite reprend donc là où on en était,
// sans état à tenir à jour ni à resynchroniser.
// `body` est un tableau : un élément par paragraphe affiché.
export const TOUR_STEPS = [
  {
    path: '/comptes',
    title: "Tes comptes et tes projets d'épargne",
    body: [
      `Retrouve ici tes comptes et mets leurs soldes à jour.`,
      `Envie de réserver une somme pour un voyage ou les imprévus ? Crée une enveloppe dans le compte de ton choix pour savoir à quoi cet argent est destiné.`,
      `L'argent reste sur ton compte bancaire : l'enveloppe t'aide simplement à l'organiser.`,
    ],
  },
  {
    path: '/template',
    title: 'Ton Template, pour gagner du temps',
    body: [
      `Salaire, loyer, abonnements… Prépare ici ce qui revient régulièrement : le montant, la fréquence, la date et le compte concerné. Chaque nouveau mois reprendra cette base.`,
      `Une facture annuelle à anticiper ? Prévois un peu chaque mois dans une enveloppe pour être prêt le moment venu.`,
      `Tu peux modifier ton Template à tout moment, sans changer les mois déjà créés.`,
    ],
  },
  {
    path: '/parametres',
    title: 'Tes réglages',
    body: [
      `Catégories, thèmes, moyens de paiement, taux d'épargne visé : tout ce qui structure l'app se règle ici. C'est aussi là que tu reviendras compléter ce que tu viens de créer.`,
    ],
  },
  {
    path: '/investissements',
    title: 'Garde un œil sur tes placements',
    body: [
      `PEA, crypto, assurance-vie… Renseigne les montants investis et mets à jour la valeur de tes placements pour suivre tes gains ou tes pertes.`,
      `Leur valeur actuelle s'ajoute à celle de tes comptes pour te donner une vue d'ensemble de ton patrimoine.`,
      `Tu n'as pas de placement pour le moment ? Tu pourras revenir ici plus tard.`,
    ],
  },
  {
    path: '/stats',
    title: 'Prends du recul sur ton budget',
    body: [
      `Comment évoluent tes dépenses ? Combien mets-tu de côté ? Retrouve ici l'évolution de ton budget et de ton patrimoine au fil des mois.`,
      `Explore tes dépenses par catégorie ou par thème pour mieux comprendre tes habitudes et ajuster ton budget à ton rythme.`,
      `Les graphiques se rempliront au fur et à mesure de tes saisies.`,
    ],
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
