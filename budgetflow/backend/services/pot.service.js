import { all, get, fromCents } from "../db/index.js";

/**
 * Cagnottes — une ligne `is_pot` par partage (Loyer avec Marion, Vacances avec Tom…).
 *
 *   payé par moi en commun = Σ entrées ½ rattachées (+ prévu des lignes ½ sans entrée)
 *   total commun           = payé par moi + payé par le partenaire (valeur portée par la ligne)
 *   ma part                = total × mon %
 *   à envoyer              = ma part − payé par moi   (négatif = le partenaire me doit)
 *
 * Rattachement : entries.pot_line_id / budget_lines.pot_line_id. Un ½ sans cagnotte
 * explicite va à la cagnotte PAR DÉFAUT du mois (la première dans l'ordre d'affichage).
 */
export function listPots(monthId) {
  return monthId === null
    ? all("SELECT * FROM budget_lines WHERE month_id IS NULL AND is_pot = 1 ORDER BY sort_order, id")
    : all("SELECT * FROM budget_lines WHERE month_id = ? AND is_pot = 1 ORDER BY sort_order, id", monthId);
}

export function compute(monthId, pot, defaultPotId) {
  const isDefault = pot.id === defaultPotId;
  const scope = isDefault ? "(x.pot_line_id = ? OR x.pot_line_id IS NULL)" : "x.pot_line_id = ?";

  const entriesCents = get(
    `SELECT COALESCE(SUM(x.amount_cents), 0) AS s FROM entries x
     WHERE x.month_id = ? AND x.is_shared = 1 AND (x.line_id IS NULL OR x.line_id != ?) AND ${scope}`,
    monthId, pot.id, pot.id
  ).s;

  // Lignes ½ sans aucune entrée : comptées pour leur prévu (règle « le réel remplace le prévu »)
  const plannedCents = get(
    `SELECT COALESCE(SUM(x.planned_amount_cents), 0) AS s FROM budget_lines x
     WHERE x.month_id = ? AND x.is_shared = 1 AND x.is_pot = 0
       AND NOT EXISTS (SELECT 1 FROM entries e WHERE e.line_id = x.id) AND ${scope}`,
    monthId, pot.id
  ).s;

  const sharedByMeCents = entriesCents + plannedCents;
  const partnerPaidCents = pot.pot_partner_paid_cents || 0;
  const totalCents = sharedByMeCents + partnerPaidCents;
  const myShare = pot.pot_my_share ?? 50;
  const myPartCents = Math.round((totalCents * myShare) / 100);
  const toSendCents = myPartCents - sharedByMeCents;

  return {
    partnerName: pot.pot_partner_name || "partenaire",
    partnerPaid: fromCents(partnerPaidCents),
    myShare,
    sharedByMe: fromCents(sharedByMeCents),
    sharedPlanned: fromCents(plannedCents),
    total: fromCents(totalCents),
    myPart: fromCents(myPartCents),
    toSend: fromCents(toSendCents),
    toSendCents,
    isDefault,
  };
}

// Toutes les cagnottes d'un mois, calculées
export function computeAll(monthId) {
  const pots = listPots(monthId);
  const defaultId = pots[0]?.id ?? null;
  return pots.map((p) => ({ id: p.id, label: p.label, ...compute(monthId, p, defaultId) }));
}
