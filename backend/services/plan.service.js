// Plan de financement — calcul pur, sans base de données.
//
// Le problème que ça résout : répartir une capacité mensuelle entre plusieurs
// objectifs, dans le temps, sachant qu'un objectif soldé libère sa part.
//
// LE MODÈLE : des ZONES et des POURCENTAGES.
//
// Une zone est une période où la répartition ne change pas. On entre dans la zone
// suivante dès qu'un objectif atteint sa cible — il sort du partage, et les autres
// se répartissent ce qu'il prenait. Le nombre de zones découle donc du nombre
// d'objectifs à cible.
//
//   zone 1   PC 60 %  ·  apport 30 %  ·  PEA 10 %      tant que le PC court
//   zone 2              apport 50 %  ·  PEA 50 %       le PC est payé
//   zone 3                             PEA 100 %       l'apport aussi
//
// C'est ce qui évite de saisir des montants mensuels à la main : on dit COMMENT on
// veut répartir, le calcul dit COMBIEN ça fait et QUAND chaque objectif tombe.
//
// Rien n'est lu ni écrit en base : ce module reçoit des chiffres et rend un tableau.

// Arrondi monétaire : on travaille en euros, jamais en flottants qui dérivent
const round2 = (n) => Math.round(n * 100) / 100;

const monthIndex = (period) => { const [y, m] = period.split("-").map(Number); return y * 12 + (m - 1); };
const periodOf = (idx) => `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;

/**
 * Nombre de zones d'un plan.
 *
 * Une zone par objectif à cible — chacun libère la sienne en se soldant — plus une
 * dernière si des objectifs sans fin subsistent après.
 *
 * @param {Array<object>} goals Les objectifs du plan.
 * @returns {number} Le nombre de zones, au moins 1.
 */
export function zoneCount(goals) {
  const aCible = goals.filter((g) => g.target != null).length;
  const sansFin = goals.some((g) => g.target == null);
  return Math.max(1, aCible + (sansFin ? 1 : 0));
}

/**
 * Répartit 1 entre des objectifs, selon les pourcentages d'une zone.
 *
 * Deux tolérances voulues : une zone non renseignée donne des parts égales — elle
 * doit produire un tableau lisible plutôt que rien — et des parts qui ne totalisent
 * pas 100 sont normalisées, pour qu'on puisse écrire 6/3/1 comme 60/30/10.
 *
 * @param {Array<object>} actifs Les objectifs qui participent au partage.
 * @param {Object<string, number>} [percents] Les parts saisies, en pourcentage.
 * @returns {Object<string, number>} La part de chacun, entre 0 et 1.
 */
function partsOf(actifs, percents = {}) {
  const bruts = actifs.map((g) => {
    const p = Number(percents?.[g.key]);
    return Number.isFinite(p) && p > 0 ? p : 0;
  });
  const somme = bruts.reduce((s, v) => s + v, 0);
  const out = {};
  if (somme <= 0) {
    actifs.forEach((g) => { out[g.key] = 1 / actifs.length; });
    return out;
  }
  actifs.forEach((g, i) => { out[g.key] = bruts[i] / somme; });
  return out;
}

/**
 * Déroule un plan de financement mois par mois.
 *
 * Chaque mois, la zone courante se lit au nombre d'objectifs déjà soldés, et ses
 * pourcentages répartissent la capacité. Trois règles encadrent ce partage :
 *
 *  - un objectif ne reçoit jamais plus que ce qu'il lui reste à financer ;
 *  - ce qu'il ne prend pas retourne aux autres, redistribué au prorata — c'est ce qui
 *    fait la bascule du mois où un objectif se solde ;
 *  - un objectif sans cible encaisse sa part indéfiniment.
 *
 * Les cellules verrouillées sont posées telles quelles et servies en premier : le
 * calcul redistribue autour d'elles au lieu de les écraser.
 *
 * @param {object} input
 * @param {number} input.capacity Somme à répartir chaque mois, en euros.
 * @param {string} input.startPeriod Premier mois du plan (AAAA-MM).
 * @param {number} [input.horizon] Nombre de mois maximum à dérouler.
 * @param {Array<object>} input.goals `{ key, name, type, target|null, startPeriod?, already? }`.
 * @param {Array<{percents: object}>} [input.zones] Répartition, une entrée par zone.
 * @param {Object<string, Object<string, number>>} [input.locks] Cellules figées.
 * @returns {{rows: Array, goals: Array, zones: Array, warnings: Array<string>}}
 */
export function computePlan({ capacity, startPeriod, horizon = 120, goals = [], zones = [], locks = {} }) {
  const start = monthIndex(startPeriod);
  const state = goals.map((g) => ({ ...g, paid: round2(g.already || 0), reached: null }));

  const estOuvert = (g) => g.target == null || g.paid < g.target;
  const aCommence = (g, i) => monthIndex(g.startPeriod || startPeriod) <= start + i;
  // La zone courante se lit au nombre d'objectifs à cible déjà soldés
  const zoneIndex = () => state.filter((g) => g.target != null && g.paid >= g.target).length;

  const rows = [];
  const zonesVues = [];
  let queue = 0;         // mois déroulés une fois toutes les cibles atteintes  // composition réelle de chaque zone, telle que le calcul l'a rencontrée

  const noterZone = (zi, period) => {
    if (zonesVues[zi]) return;
    zonesVues[zi] = {
      index: zi,
      from: period,
      goals: state.filter((g) => estOuvert(g)).map((g) => g.key),
      percents: zones[zi]?.percents || {},
    };
  };

  for (let i = 0; i < horizon; i++) {
    const period = periodOf(start + i);
    const cells = {};
    const lockRow = locks[period] || {};
    let left = capacity;

    // 1. Les cellules verrouillées passent d'abord : elles ne se discutent pas.
    for (const g of state) {
      if (!(g.key in lockRow)) continue;
      const v = round2(Math.max(0, lockRow[g.key]));
      cells[g.key] = v;
      g.paid = round2(g.paid + v);
      left = round2(left - v);
    }

    noterZone(zoneIndex(), period);

    // 2. Répartition en plusieurs passes : ce qu'un objectif saturé ne prend pas
    //    revient aux autres. La zone est relue à chaque passe, donc un objectif soldé
    //    en cours de mois fait basculer le reste du mois sur la répartition suivante.
    for (let passe = 0; passe <= state.length && left > 0.005; passe++) {
      const zi = zoneIndex();
      noterZone(zi, period);
      const percents = zones[zi]?.percents;

      const actifs = state.filter((g) =>
        estOuvert(g) && aCommence(g, i) && !(g.key in lockRow)
        && (g.target == null || round2(g.target - g.paid) > 0));
      if (!actifs.length) break;

      const parts = partsOf(actifs, percents);
      const aRepartir = left;
      let servi = 0;

      for (const g of actifs) {
        const vise = round2(aRepartir * parts[g.key]);
        if (vise <= 0) continue;
        const plafond = g.target == null ? vise : Math.min(vise, round2(g.target - g.paid));
        const v = round2(Math.min(plafond, round2(left - servi)));
        if (v <= 0) continue;
        cells[g.key] = round2((cells[g.key] || 0) + v);
        g.paid = round2(g.paid + v);
        servi = round2(servi + v);
      }

      left = round2(left - servi);
      if (servi <= 0) break;  // plus personne ne peut absorber : le surplus reste non employé
    }

    for (const g of state) {
      if (g.target != null && g.reached === null && g.paid >= g.target) g.reached = period;
    }

    rows.push({ period, cells, total: round2(Object.values(cells).reduce((s, v) => s + v, 0)) });

    // Toutes les cibles sont soldées : le plan est fini, mais la dernière zone — celle
    // où il ne reste que les objectifs sans fin — mérite d'apparaître. Le compteur
    // démarre au mois du solde, donc 3 laisse deux mois de zone finale pleine : assez
    // pour la voir, sans partir vers l'infini.
    // Un plan qui n'a JAMAIS eu de cible, lui, ne se solde pas : on en montre une année.
    const resteACibler = state.some((g) => g.target != null && g.paid < g.target);
    const perpetuels = state.some((g) => g.target == null);
    const aEuDesCibles = state.some((g) => g.target != null);
    if (!resteACibler) {
      if (!perpetuels) break;
      queue++;
      if (queue >= (aEuDesCibles ? 3 : 12)) break;
    }
  }

  // Les mois de tête où rien ne bouge n'apprennent rien : tant qu'aucun objectif n'a
  // démarré, la capacité n'est versée nulle part. On entre donc dans le plan au premier
  // mois qui reçoit quelque chose, plutôt que d'ouvrir sur des lignes à zéro.
  // Un plan qui ne reçoit JAMAIS rien reste affiché tel quel : c'est son diagnostic.
  const premierActif = rows.findIndex((r) => r.total > 0);
  if (premierActif > 0) {
    rows.splice(0, premierActif);
    // La zone 1 commence là où le plan commence vraiment
    for (const z of zonesVues) if (z && z.from < rows[0].period) z.from = rows[0].period;
  }

  const goalsOut = state.map((g) => ({
    key: g.key, name: g.name, type: g.type, target: g.target,
    paid: g.paid, reached: g.reached,
    shortfall: g.target == null ? null : round2(Math.max(0, g.target - g.paid)),
  }));

  const warnings = [];
  if (capacity <= 0) warnings.push("La somme à répartir est nulle : renseignez vos revenus et vos charges, ou saisissez-la directement.");
  for (const g of goalsOut) {
    if (g.shortfall > 0) warnings.push(`« ${g.name} » n'est pas atteint à l'horizon : il manque ${g.shortfall} €.`);
  }

  return { rows, goals: goalsOut, zones: zonesVues.filter(Boolean), warnings };
}

/**
 * Part mensuelle qu'il faudrait pour atteindre un objectif dans un délai donné.
 *
 * L'autre sens du calcul, pour vérifier un ordre de grandeur avant de régler les
 * pourcentages : « le PC en 8 mois, ça fait combien par mois ? ».
 *
 * @param {number} target Montant à réunir.
 * @param {number} months Nombre de mois voulus.
 * @param {number} [already] Ce qui est déjà mis de côté.
 * @returns {number} La part mensuelle, arrondie au centime supérieur.
 */
export function shareFor(target, months, already = 0) {
  const reste = Math.max(0, target - already);
  if (months <= 0) return reste;
  return Math.ceil((reste / months) * 100) / 100;
}
