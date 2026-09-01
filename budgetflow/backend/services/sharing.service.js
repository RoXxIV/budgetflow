import { all, get, run, toCents, fromCents, httpError } from "../db/index.js";
import { assertOpen } from "./month.service.js";

/**
 * Module Partage — un seul chiffre en sortie : « à envoyer » (négatif = à recevoir).
 *
 *   payé par moi en commun = Σ entrées marquées ½ (+ prévu des lignes ½ sans entrée)
 *   payé par le partenaire = Σ « paie directement » (paramètres)
 *   total commun           = les deux
 *   ma part                = total × mon %
 *   à envoyer              = ma part − payé par moi
 */
export function compute(monthId, settingsRow) {
  if (!settingsRow.sharing_enabled) return null;

  const partnerPayments = JSON.parse(settingsRow.sharing_partner_payments || "[]");
  const partnerPaidCents = partnerPayments.reduce((s, p) => s + (toCents(p.amount) || 0), 0);

  // Entrées ½ du mois
  const sharedEntriesCents = get(
    "SELECT COALESCE(SUM(amount_cents), 0) AS s FROM entries WHERE month_id = ? AND is_shared = 1", monthId
  ).s;
  // Lignes ½ sans aucune entrée : comptées pour leur prévu (même règle que le projeté)
  const sharedPlannedCents = get(
    `SELECT COALESCE(SUM(planned_amount_cents), 0) AS s FROM budget_lines bl
     WHERE bl.month_id = ? AND bl.is_shared = 1
       AND NOT EXISTS (SELECT 1 FROM entries e WHERE e.line_id = bl.id)`, monthId
  ).s;
  const sharedByMeCents = sharedEntriesCents + sharedPlannedCents;

  const totalCents = sharedByMeCents + partnerPaidCents;
  const myShare = settingsRow.sharing_my_share ?? 50;
  const myPartCents = Math.round(totalCents * myShare / 100);
  const toSendCents = myPartCents - sharedByMeCents;

  // Ligne cible sur ce mois (copie de la ligne du template) et montant déjà appliqué
  let targetLine = null;
  if (settingsRow.sharing_target_line_id) {
    const line = get(
      "SELECT * FROM budget_lines WHERE month_id = ? AND template_line_id = ?",
      monthId, settingsRow.sharing_target_line_id
    );
    if (line) {
      const applied = get(
        "SELECT COALESCE(SUM(amount_cents), 0) AS s FROM entries WHERE line_id = ? AND source = 'regularisation'", line.id
      ).s;
      targetLine = { id: line.id, label: line.label, applied: fromCents(applied) };
    }
  }

  return {
    partnerName: settingsRow.sharing_partner_name || "partenaire",
    myShare,
    sharedByMe: fromCents(sharedByMeCents),
    sharedPlanned: fromCents(sharedPlannedCents),
    partnerPaid: fromCents(partnerPaidCents),
    partnerPayments,
    total: fromCents(totalCents),
    myPart: fromCents(myPartCents),
    toSend: fromCents(toSendCents),
    targetLine,
  };
}

// « Appliquer » : pose le montant à envoyer sur la ligne cible (remplace l'application précédente)
export function apply(monthId) {
  assertOpen(monthId);
  const settingsRow = get("SELECT * FROM app_settings WHERE id = 1");
  const sharing = compute(monthId, settingsRow);
  if (!sharing) throw httpError(400, "Module Partage désactivé");
  if (!sharing.targetLine) throw httpError(400, "Aucune ligne cible sur ce mois (choisir une ligne du template dans les Paramètres)");
  if (sharing.toSend <= 0) throw httpError(400, "Rien à envoyer ce mois");

  const line = get("SELECT * FROM budget_lines WHERE id = ?", sharing.targetLine.id);
  run("DELETE FROM entries WHERE line_id = ? AND source = 'regularisation'", line.id);
  run(
    `INSERT INTO entries (month_id, line_id, label, amount_cents, account_id, to_account_id, source)
     VALUES (?, ?, ?, ?, ?, ?, 'regularisation')`,
    monthId, line.id, `Partage — ${sharing.partnerName}`, toCents(sharing.toSend),
    line.from_account_id ?? get("SELECT id FROM accounts WHERE is_main = 1 LIMIT 1")?.id ?? null,
    line.to_account_id
  );
  return compute(monthId, settingsRow);
}
