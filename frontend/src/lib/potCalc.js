// La formule des cagnottes, côté écran.
//
// POURQUOI ELLE EXISTE ICI AUSSI — le backend calcule les cagnottes d'un MOIS, à partir
// des entrées réelles. Le Template, lui, n'a pas de mois à interroger : ses lignes n'ont
// aucune entrée. Il lui faut donc sa propre implémentation pour afficher l'aperçu du
// partage pendant qu'on saisit.
//
// C'est le seul calcul d'argent du projet qui existe en deux exemplaires, et la revue du
// 08/09 a montré ce que ça coûte : la version précédente travaillait en euros et
// arrondissait après la soustraction, là où le serveur travaille en centimes et
// arrondit avant. Résultat, un écart d'un centime dès que le total commun était impair —
// une fois sur deux, et avril 2026 était touché.
//
// D'où les deux règles tenues ici : **tout en centimes**, et **le même ordre d'arrondi
// que le serveur**. Un test différentiel (backend/tests/cagnotte.test.mjs) confronte les
// deux implémentations sur un balayage de valeurs à chaque `npm test`.

// Les montants arrivent en euros depuis l'API ; on repasse en centimes pour calculer.
const toCents = (euros) => Math.round((Number(euros) || 0) * 100);
const fromCents = (cents) => cents / 100;

/**
 * Calcule où en est une cagnotte : ce que chacun a payé, et ce qu'il reste à envoyer.
 *
 * Le raisonnement : on somme ce que J'AI déjà payé sur mes lignes ½, on y ajoute ce que
 * le partenaire a payé pour obtenir le total commun, on en prend ma part (50 % par
 * défaut), et l'écart avec ce que j'ai déjà sorti est ce que je dois encore envoyer —
 * négatif si j'ai trop payé.
 *
 * Une ligne ½ sans cagnotte désignée rejoint la cagnotte par défaut, exactement comme
 * côté serveur : sans cette règle, cocher « partagé » sans y penser ferait disparaître
 * la dépense du partage.
 *
 * @param {object} pot La ligne de cagnotte (`isPot`), avec `potPartnerPaid` et `potMyShare`.
 * @param {Array<object>} lines Toutes les lignes du registre, pour retrouver les ½.
 * @param {number|null} [defaultPotId] La cagnotte par défaut — la première affichée.
 * @returns {{sharedByMe: number, partnerPaid: number, total: number, myShare: number,
 *   myPart: number, partnerName: string, toSend: number}} Montants en euros.
 */
export function potCalc(pot, lines = [], defaultPotId = null) {
  const sharedByMeCents = lines.reduce((s, l) => {
    if (!l.isShared || l.isPot) return s;
    return (l.potLineId || defaultPotId) === pot.id ? s + toCents(l.plannedAmount) : s;
  }, 0);
  const partnerPaidCents = toCents(pot.potPartnerPaid);
  const totalCents = sharedByMeCents + partnerPaidCents;
  const myShare = pot.potMyShare ?? 50;
  // L'arrondi tombe ICI, sur ma part, avant la soustraction — comme dans pot.service.js.
  // Arrondir après donnerait un centime d'écart un total impair sur deux.
  const myPartCents = Math.round((totalCents * myShare) / 100);
  return {
    sharedByMe: fromCents(sharedByMeCents),
    partnerPaid: fromCents(partnerPaidCents),
    total: fromCents(totalCents),
    myShare,
    myPart: fromCents(myPartCents),
    partnerName: pot.potPartnerName || 'partenaire',
    toSend: fromCents(myPartCents - sharedByMeCents),
  };
}
