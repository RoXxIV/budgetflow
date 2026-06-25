/**
 * Calcul des soldes temps réel par compte.
 *
 * La logique est partagée entre SheetView, HomeView et GoalsView.
 * Chaque vue part d'un snapshot (solde initial de début de mois) et y applique
 * les mouvements réels enregistrés sur le sheet actif :
 *   - Lignes budgétaires : toAccount reçoit, fromAccount débite
 *   - Contributions objectifs : débite le compte principal, crédite le compte de l'objectif
 *   - Transactions d'investissement : idem
 */

/**
 * Construit une map { accountId → balance_initiale } à partir des snapshots du sheet.
 *
 * @param {Array} snapshots - AccountSnapshot[] peuplés avec { account, balance }
 * @returns {Object} { [accountId]: number }
 */
export function buildSnapshotMap(snapshots) {
  const map = {}
  snapshots.forEach((s) => {
    map[s.account?._id || s.account] = s.balance
  })
  return map
}

/**
 * Calcule la variation (delta) de chaque compte sur un mois donné,
 * à partir des mouvements réels du sheet.
 *
 * @param {Object} params
 * @param {Array}  params.lines          - BudgetLine[] du mois (dépenses & revenus)
 * @param {Array}  params.contributions  - SavingContribution[] du mois
 * @param {Array}  params.investmentTxs  - InvestmentTransaction[] du mois
 * @param {Array}  params.goals          - SavingGoal[] (pour retrouver le compte cible d'un objectif)
 * @param {string|null} params.mainAccountId - ID du compte principal (débité pour épargne/investissement)
 * @returns {Object} { [accountId]: number } delta à ajouter au snapshot
 */
export function computeAccountDeltaMap({ lines, contributions, investmentTxs, goals, mainAccountId }) {
  const deltaMap = {}

  // Lignes budgétaires : mouvements entre comptes
  lines.forEach((l) => {
    const toId = l.toAccount?._id || l.toAccount
    const fromId = l.fromAccount?._id || l.fromAccount
    if (toId && l.actualAmount) deltaMap[toId] = (deltaMap[toId] || 0) + l.actualAmount
    if (fromId && l.actualAmount) deltaMap[fromId] = (deltaMap[fromId] || 0) - l.actualAmount
  })

  // Contributions objectifs : -montant sur compte principal, +montant sur compte de l'objectif
  contributions.forEach((c) => {
    const cGoalId = c.goal?._id || c.goal
    const goal = goals.find((g) => String(g._id) === String(cGoalId))
    const goalAccountId = goal?.account?._id || goal?.account
    if (mainAccountId) deltaMap[mainAccountId] = (deltaMap[mainAccountId] || 0) - (c.amount || 0)
    if (goalAccountId) deltaMap[goalAccountId] = (deltaMap[goalAccountId] || 0) + (c.amount || 0)
  })

  // Transactions investissement : -montant sur compte principal, +montant sur compte de l'investissement
  investmentTxs.forEach((t) => {
    const investAccountId = t.investment?.account?._id || t.investment?.account
    if (mainAccountId) deltaMap[mainAccountId] = (deltaMap[mainAccountId] || 0) - (t.amount || 0)
    if (investAccountId) deltaMap[investAccountId] = (deltaMap[investAccountId] || 0) + (t.amount || 0)
  })

  return deltaMap
}

/**
 * Calcule le solde actuel de chaque compte (snapshot + delta).
 * Retourne null si aucun snapshot ni aucun mouvement n'existe pour ce compte.
 *
 * @param {Object} snapshotMap - résultat de buildSnapshotMap()
 * @param {Object} deltaMap    - résultat de computeAccountDeltaMap()
 * @param {string} accountId
 * @returns {number | null}
 */
export function resolveBalance(snapshotMap, deltaMap, accountId) {
  const snapshot = snapshotMap[accountId] ?? null
  const delta = deltaMap[accountId] || 0
  return snapshot !== null || delta !== 0 ? (snapshot ?? 0) + delta : null
}
