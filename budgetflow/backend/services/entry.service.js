import { all, get, run, toCents, fromCents, httpError } from "../db/index.js";
import { assertOpen } from "./month.service.js";
import * as pots from "./pot.service.js";
import { syncEntryExpense } from "./envelope.service.js";
import { nextDueDate } from "./budgetLine.service.js";

function serialize(row) {
  return {
    id: row.id,
    monthId: row.month_id,
    lineId: row.line_id,
    potLineId: row.pot_line_id,
    label: row.label,
    amount: fromCents(row.amount_cents),
    date: row.date,
    accountId: row.account_id,
    toAccountId: row.to_account_id,
    paymentMethod: row.payment_method,
    themeId: row.theme_id,
    isShared: !!row.is_shared,
    source: row.source,
    notes: row.notes,
    envelopeId: row.envelope_id,           // « depuis l'enveloppe » : dépense liée
    envelopeInTarget: !!row.envelope_in_target,
    relatedLineId: row.related_line_id,    // virement système rattaché à une ligne (sans ligne ni catégorie)
  };
}

export function listByMonth(monthId) {
  return all("SELECT * FROM entries WHERE month_id = ? ORDER BY date, id", monthId).map(serialize);
}

export function create(monthId, data) {
  assertOpen(monthId);
  const cents = toCents(data.amount);
  if (!cents) throw httpError(400, "Montant requis");
  let line = null;
  if (data.lineId) {
    line = get("SELECT * FROM budget_lines WHERE id = ? AND month_id = ?", data.lineId, monthId);
    if (!line) throw httpError(400, "Ligne inconnue sur ce mois");
  }
  // Une entrée sans compte ne bougerait aucun solde : repli sur le compte principal
  let accountId = data.accountId ?? null;
  if (!accountId) accountId = get("SELECT id FROM accounts WHERE is_main = 1 LIMIT 1")?.id ?? null;
  // ½ : cagnotte explicite, sinon celle de la ligne, sinon la cagnotte par défaut (NULL)
  const potLineId = data.potLineId !== undefined ? (data.potLineId || null) : (line?.pot_line_id ?? null);
  // Ligne mensualisée : une entrée manuelle sort par défaut de son enveloppe, sans entamer la cible (le cycle se renouvelle)
  const recurringEnvelope = line?.envelope_id && data.envelopeId === undefined;
  const envelopeId = recurringEnvelope ? line.envelope_id : (data.envelopeId || null);
  const inTarget = recurringEnvelope ? 0 : (data.envelopeInTarget === false ? 0 : 1);

  const { lastInsertRowid: id } = run(
    `INSERT INTO entries (month_id, line_id, label, amount_cents, date, account_id, to_account_id, payment_method, theme_id, is_shared, pot_line_id, source, notes, envelope_id, envelope_in_target, related_line_id)
     VALUES (?, ?, ?, ?, COALESCE(?, date('now')), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    monthId, data.lineId ?? null, data.label ?? null, cents, data.date ?? null,
    accountId, data.toAccountId ?? null, data.paymentMethod ?? null, data.themeId ?? null,
    data.isShared ? 1 : 0, potLineId, data.source ?? "manuelle", data.notes ?? null,
    envelopeId, inTarget, data.relatedLineId ?? null
  );
  const row = get("SELECT * FROM entries WHERE id = ?", id);
  syncEntryExpense(row);
  // La boucle se referme : l'échéance de l'enveloppe avance au cycle suivant
  if (line?.envelope_id && envelopeId === line.envelope_id && (line.interval_months || 1) > 1) {
    const next = nextDueDate(line, row.date.substring(0, 7)); // occurrence courante…
    const after = nextDueDate(line, periodPlus(row.date.substring(0, 7), 1)); // …puis la suivante
    run("UPDATE envelopes SET deadline = ? WHERE id = ?", after || next, line.envelope_id);
  }
  return serialize(row);
}

const periodPlus = (period, n) => {
  const [y, m] = period.split("-").map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
};

export function update(id, data) {
  const existing = get("SELECT * FROM entries WHERE id = ?", id);
  if (!existing) throw httpError(404, "Entrée introuvable");
  assertOpen(existing.month_id);

  const val = (key, dbKey, transform = (v) => v) =>
    data[key] !== undefined ? transform(data[key]) : existing[dbKey];
  const cents = data.amount !== undefined ? toCents(data.amount) : existing.amount_cents;
  if (!cents) throw httpError(400, "Montant requis");

  run(
    `UPDATE entries SET label = ?, amount_cents = ?, date = ?, account_id = ?, to_account_id = ?,
       payment_method = ?, theme_id = ?, is_shared = ?, pot_line_id = ?, notes = ?,
       envelope_id = ?, envelope_in_target = ? WHERE id = ?`,
    val("label", "label"), cents, val("date", "date"),
    val("accountId", "account_id"), val("toAccountId", "to_account_id"),
    val("paymentMethod", "payment_method"),
    val("themeId", "theme_id"), val("isShared", "is_shared", (v) => (v ? 1 : 0)),
    val("potLineId", "pot_line_id", (v) => v || null),
    val("notes", "notes"),
    val("envelopeId", "envelope_id", (v) => v || null),
    val("envelopeInTarget", "envelope_in_target", (v) => (v === false ? 0 : 1)),
    id
  );
  const row = get("SELECT * FROM entries WHERE id = ?", id);
  syncEntryExpense(row); // la contribution « depense » liée suit (montant, date, enveloppe, objectif)
  return serialize(row);
}

export function remove(id) {
  const existing = get("SELECT * FROM entries WHERE id = ?", id);
  if (!existing) throw httpError(404, "Entrée introuvable");
  assertOpen(existing.month_id);
  run("DELETE FROM entries WHERE id = ?", id);
  // Dernière entrée d'une ligne supprimée → ses virements système n'ont plus de raison d'être,
  // et l'échéance d'une ligne mensualisée revient au cycle courant (la case ☐ réapparaît si un prévu reste)
  if (existing.line_id) {
    const left = get("SELECT COUNT(*) AS n FROM entries WHERE line_id = ?", existing.line_id).n;
    if (left === 0) {
      run("DELETE FROM entries WHERE related_line_id = ?", existing.line_id);
      const line = get("SELECT * FROM budget_lines WHERE id = ?", existing.line_id);
      if (line?.envelope_id && (line.interval_months || 1) > 1) {
        const month = get("SELECT * FROM months WHERE id = ?", existing.month_id);
        run("UPDATE envelopes SET deadline = ? WHERE id = ?", nextDueDate(line, month.period), line.envelope_id);
      }
    }
  }
  return { message: "Entrée supprimée" };
}

// ─── ☐ payé : crée l'entrée au prévu, à la date du jour récurrent ───
// Ligne mensualisée dont l'enveloppe ne couvre pas le montant : sans shortfallAccountId → 409 ENVELOPE_SHORT
// (le front propose « vider l'enveloppe et prendre le reste sur … ») ; avec → deux entrées : la part
// couverte sort de l'enveloppe (compte hôte), le reste du compte indiqué. L'enveloppe ne devient jamais négative.
export function pay(monthId, lineId, { shortfallAccountId = null } = {}) {
  const month = assertOpen(monthId);
  const line = get("SELECT * FROM budget_lines WHERE id = ? AND month_id = ?", lineId, monthId);
  if (!line) throw httpError(404, "Ligne introuvable sur ce mois");

  // Cagnotte : le montant est le « à envoyer » calculé (négatif = le partenaire me doit)
  let amountCents = line.planned_amount_cents;
  if (line.is_pot) {
    const potList = pots.listPots(monthId);
    amountCents = pots.compute(monthId, line, potList[0]?.id ?? null).toSendCents;
    if (!amountCents) throw httpError(400, "Rien à régler sur cette cagnotte");
  } else if (!amountCents) {
    throw httpError(400, "Le montant prévu de la ligne est vide");
  }

  // « ☐ payé » n'existe que sur une ligne sans entrée : le réel remplace le prévu ensuite
  const count = get("SELECT COUNT(*) AS n FROM entries WHERE line_id = ?", lineId).n;
  if (count > 0) throw httpError(409, "Cette ligne a déjà des entrées");

  // La date reste dans le mois de la fiche : jour récurrent, sinon aujourd'hui si on y est, sinon le 1er
  const today = new Date().toISOString().substring(0, 10);
  const day = line.recurring_day
    ? `${month.period}-${String(line.recurring_day).padStart(2, "0")}`
    : (today.startsWith(month.period) ? today : `${month.period}-01`);

  const base = {
    lineId,
    date: day,
    toAccountId: line.from_account_id ? line.to_account_id : null, // les deux si la ligne est un mouvement entre comptes
    paymentMethod: line.payment_method,
    themeId: line.theme_id,
    isShared: !!line.is_shared,
    source: "paye",
  };

  // Ligne mensualisée : on enregistre ce que la banque montre.
  //   1. l'entrée réelle : le montant complet depuis le compte prélevé (« Depuis » de la ligne)
  //   2. un virement système enveloppe → compte prélevé, de ce que l'enveloppe couvre (c'est lui qui vide l'enveloppe)
  //   3. si le reste est pris sur un autre compte que le compte prélevé : un virement système de ce compte
  // Les virements système n'ont ni ligne ni catégorie (jamais comptés en dépense), sont rattachés à la ligne.
  if (line.envelope_id) {
    const envelope = get("SELECT * FROM envelopes WHERE id = ?", line.envelope_id);
    const available = Math.max(0, get("SELECT COALESCE(SUM(amount_cents), 0) AS s FROM envelope_contributions WHERE envelope_id = ?", line.envelope_id).s);
    const missing = amountCents - available;
    if (missing > 0 && !shortfallAccountId) {
      const err = httpError(409, `L'enveloppe « ${envelope.name} » ne contient que ${fromCents(available).toLocaleString("fr-FR", { minimumFractionDigits: 2 })} € sur ${fromCents(amountCents).toLocaleString("fr-FR", { minimumFractionDigits: 2 })} €`);
      err.payload = { code: "ENVELOPE_SHORT", envelopeId: envelope.id, envelopeName: envelope.name, available: fromCents(available), missing: fromCents(missing), amount: fromCents(amountCents) };
      throw err;
    }
    const mainId = get("SELECT id FROM accounts WHERE is_main = 1 LIMIT 1")?.id ?? null;
    const charged = line.from_account_id ?? mainId;           // compte réellement prélevé
    const host = envelope.account_id ?? mainId;               // où l'enveloppe attend
    const covered = Math.min(amountCents, available);
    const accName = (id) => get("SELECT name FROM accounts WHERE id = ?", id)?.name || "?";

    const entry = create(monthId, { ...base, amount: fromCents(amountCents), accountId: charged, envelopeId: null });
    if (covered > 0) {
      create(monthId, {
        date: day, source: "paye", relatedLineId: lineId,
        amount: fromCents(covered), accountId: host, toAccountId: charged,
        envelopeId: envelope.id, envelopeInTarget: false,
        label: host === charged ? `Pris dans l'enveloppe « ${envelope.name} »` : `Enveloppe « ${envelope.name} » : ${accName(host)} → ${accName(charged)}`,
      });
    }
    if (missing > 0 && shortfallAccountId !== charged) {
      create(monthId, {
        date: day, source: "paye", relatedLineId: lineId,
        amount: fromCents(missing), accountId: shortfallAccountId, toAccountId: charged, envelopeId: null,
        label: `Reste pour « ${line.label} » : ${accName(shortfallAccountId)} → ${accName(charged)}`,
      });
    }
    // L'échéance avance d'un cycle (create ne le fait que pour une entrée liée à l'enveloppe, ici le virement)
    if ((line.interval_months || 1) > 1) {
      run("UPDATE envelopes SET deadline = ? WHERE id = ?", nextDueDate(line, periodPlus(month.period, 1)), envelope.id);
    }
    return entry;
  }

  return create(monthId, {
    ...base,
    amount: fromCents(amountCents),
    accountId: line.from_account_id ?? line.to_account_id ?? null,
  });
}

// Décocher : ne retire que les entrées créées par « payé » (jamais les saisies manuelles)
export function unpay(monthId, lineId) {
  const month = assertOpen(monthId);
  const entries = all("SELECT * FROM entries WHERE (line_id = ? OR related_line_id = ?) AND source = 'paye'", lineId, lineId);
  if (!entries.length) throw httpError(404, "Aucune entrée « payé » sur cette ligne");
  for (const e of entries) run("DELETE FROM entries WHERE id = ?", e.id); // virements système et contributions « depense » liées suivent
  // Ligne mensualisée : l'échéance revient au cycle courant
  const line = get("SELECT * FROM budget_lines WHERE id = ?", lineId);
  if (line?.envelope_id && (line.interval_months || 1) > 1) {
    run("UPDATE envelopes SET deadline = ? WHERE id = ?", nextDueDate(line, month.period), line.envelope_id);
  }
  return { message: "Marquage payé retiré" };
}
