// Les lignes budgétaires — la même table sert deux rôles, et c'est la clé du fichier.
//
//     month_id IS NULL   →  une ligne du TEMPLATE, le budget type
//     month_id = 12       →  sa COPIE dans un mois, qui vit sa vie propre
//
// La copie garde le lien vers son origine (`template_line_id`), ce qui permet les deux
// gestes du quotidien : « appliquer au mois » pousse la définition du template vers la
// copie, « reporter dans le template » fait l'inverse. Aucun des deux ne touche au
// RÉEL du mois : seule la définition circule, jamais les entrées.
//
// Une ligne peut aussi être une CAGNOTTE (`is_pot`), dont le prévu n'est pas saisi mais
// calculé par pot.service, ou être MENSUALISÉE — une charge annuelle adossée à une
// enveloppe qu'on remplit tous les mois.

import { all, get, run, tx, toCents, fromCents, httpError } from "../db/index.js";

// ─── Périodicité : « tous les N mois », ancrée sur un mois ───
// L'ancrage est un NUMÉRO DE MOIS (1 = janvier), pas une date : une charge trimestrielle
// ancrée en février tombe en février, mai, août, novembre — quelle que soit l'année.
const monthIndex = (period) => { const [y, m] = period.split("-").map(Number); return y * 12 + (m - 1); };
const periodOf = (idx) => `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;

/**
 * La ligne tombe-t-elle sur ce mois ('YYYY-MM') ?
 *
 * Le double modulo n'est pas une coquetterie : `(m - anchor)` est négatif pour les
 * mois qui précèdent l'ancrage dans l'année, et `%` garde le signe en JavaScript.
 * Sans lui, une ligne ancrée en novembre ne tomberait jamais en février.
 *
 * @param {object} line La ligne, avec `interval_months` et `anchor_month`.
 * @param {string} period Le mois testé.
 * @returns {boolean} Vrai pour toute ligne mensuelle.
 */
export function cycleMatches(line, period) {
  const interval = line.interval_months || 1;
  if (interval <= 1 || !line.anchor_month) return true;
  const [, m] = period.split("-").map(Number);
  return (((m - line.anchor_month) % interval) + interval) % interval === 0;
}

/**
 * Prochaine occurrence (date ISO) à partir d'un mois donné inclus.
 *
 * Le jour est borné au dernier jour du mois cible : « le 31 » en février donnerait
 * 2026-02-31, une date invalide qui rendait la mensualité suggérée NaN (revue du 04/09).
 *
 * La boucle s'arrête à 24 mois : au-delà, c'est que la périodicité est incohérente, et
 * mieux vaut rendre null que tourner.
 *
 * @param {object} line La ligne et son cycle.
 * @param {string} fromPeriod Le mois de départ, inclus.
 * @returns {string|null} La date ISO de l'échéance.
 */
export function nextDueDate(line, fromPeriod) {
  const interval = line.interval_months || 1;
  let idx = monthIndex(fromPeriod);
  for (let i = 0; i < 24; i++) {
    const p = periodOf(idx + i);
    if (cycleMatches(line, p)) {
      const [y, m] = p.split("-").map(Number);
      const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const day = Math.min(line.recurring_day || 1, lastDay);
      return `${p}-${String(day).padStart(2, "0")}`;
    }
  }
  return null;
}
const currentPeriod = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`; };

/**
 * Sérialisation commune des lignes budgétaires (template et mois).
 *
 * `monthlyAmount` mérite l'attention : une charge annuelle de 120 € ne pèse pas 120 €
 * dans un mois-type, elle en pèse 10. Les totaux du Template s'appuient sur cette part
 * mensuelle — sans elle, ils additionneraient des euros par an et des euros par mois.
 *
 * @param {object} row La ligne en base.
 * @returns {object} La ligne exposée par l'API.
 */
export function serialize(row) {
  return {
    intervalMonths: row.interval_months || 1,
    anchorMonth: row.anchor_month,
    envelopeId: row.envelope_id,     // mensualisée : enveloppe liée
    nextDue: row.month_id === null && (row.interval_months || 1) > 1 ? nextDueDate(row, currentPeriod()) : null,
    id: row.id,
    monthId: row.month_id,
    templateLineId: row.template_line_id,
    label: row.label,
    categoryId: row.category_id,
    themeId: row.theme_id,
    plannedAmount: fromCents(row.planned_amount_cents),
    // Part mensuelle : une ligne non mensuelle (annuelle, trimestrielle…) ne pèse qu'une
    // fraction dans un mois-type. Les totaux du template s'appuient dessus, sinon ils
    // additionnent des euros par an et des euros par mois.
    monthlyAmount: fromCents(Math.round((row.planned_amount_cents ?? 0) / (row.interval_months || 1))),
    fromAccountId: row.from_account_id,
    toAccountId: row.to_account_id,
    paymentMethod: row.payment_method,
    isShared: !!row.is_shared,
    recurringDay: row.recurring_day,
    sortOrder: row.sort_order,
    notes: row.notes,
    // Cagnotte (partage) : le prévu est calculé à partir des ½ rattachés
    isPot: !!row.is_pot,
    potPartnerName: row.pot_partner_name,
    potPartnerPaid: fromCents(row.pot_partner_paid_cents ?? 0),
    potMyShare: row.pot_my_share ?? 50,
    potLineId: row.pot_line_id, // cagnotte par défaut des ½ de cette ligne
  };
}

// monthId === null → lignes du template
export function listByMonth(monthId) {
  const rows = monthId === null
    ? all("SELECT * FROM budget_lines WHERE month_id IS NULL ORDER BY sort_order, id")
    : all("SELECT * FROM budget_lines WHERE month_id = ? ORDER BY sort_order, id", monthId);
  return rows.map(serialize);
}

export function getById(id) {
  const row = get("SELECT * FROM budget_lines WHERE id = ?", id);
  if (!row) throw httpError(404, "Ligne introuvable");
  return serialize(row);
}

/**
 * Crée une ligne, dans le template (`monthId` null) ou dans un mois.
 *
 * Une cagnotte est forcée à un prévu de zéro : son montant est un résultat, calculé à
 * partir des ½ qui lui sont rattachés. Le laisser saisissable donnerait deux sources
 * de vérité pour le même chiffre.
 *
 * @param {number|null} monthId Le mois, ou null pour le template.
 * @param {object} data Les champs de la ligne.
 * @returns {object} La ligne créée, placée en fin de liste.
 */
export function create(monthId, data) {
  const label = (data.label || "").trim();
  if (!label) throw httpError(400, "Le libellé de la ligne est requis");
  if (data.fromAccountId && data.toAccountId && data.fromAccountId === data.toAccountId) {
    throw httpError(400, "Depuis et Vers sont le même compte : un virement doit en changer (ou laissez Vers sur « extérieur »)");
  }
  const interval = Math.max(1, Number(data.intervalMonths) || 1);
  const anchor = interval > 1 ? (Number(data.anchorMonth) || null) : null;
  if (interval > 1 && !anchor) throw httpError(400, "Indiquez le mois d'ancrage pour une ligne non mensuelle");

  const scope = monthId === null ? "month_id IS NULL" : "month_id = ?";
  const max = monthId === null
    ? get(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM budget_lines WHERE ${scope}`).m
    : get(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM budget_lines WHERE ${scope}`, monthId).m;

  const { lastInsertRowid: id } = run(
    `INSERT INTO budget_lines
      (month_id, template_line_id, label, category_id, theme_id, planned_amount_cents,
       from_account_id, to_account_id, payment_method, is_shared, recurring_day, sort_order, notes,
       is_pot, pot_partner_name, pot_partner_paid_cents, pot_my_share, pot_line_id,
       interval_months, anchor_month)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    monthId, data.templateLineId ?? null, label,
    data.categoryId ?? null, data.themeId ?? null,
    data.isPot ? 0 : (toCents(data.plannedAmount) ?? 0),
    data.fromAccountId ?? null, data.toAccountId ?? null,
    data.paymentMethod ?? null, data.isShared ? 1 : 0,
    data.recurringDay ?? null, max + 1, data.notes ?? null,
    data.isPot ? 1 : 0, data.potPartnerName ?? null, toCents(data.potPartnerPaid) ?? 0,
    data.potMyShare ?? 50, data.potLineId ?? null,
    interval, anchor
  );
  return getById(Number(id));
}

/**
 * Modifie une ligne, avec deux propagations volontaires.
 *
 * **Vers l'enveloppe liée** — sur une ligne mensualisée du template, le nom, la cible
 * et l'échéance de l'enveloppe suivent la ligne : ce sont deux faces du même objet, les
 * laisser diverger n'aurait aucun sens.
 *
 * **Vers les entrées** — sur une ligne de MOIS, les champs « partagés » (thème, moyen
 * de paiement, ½, cagnotte, compte) sont répercutés sur TOUTES les entrées de la ligne.
 * C'est un changement de masse, validé par Evan : corriger le thème d'une ligne doit
 * corriger ses dix entrées, sinon les statistiques restent fausses. Montants, dates et
 * détails, eux, restent propres à chaque entrée.
 *
 * Deux exclusions dans cette propagation de compte : une dépense payée depuis une
 * enveloppe garde son compte hôte, et un virement système garde le sien — dans les
 * deux cas, le compte n'est pas un choix de saisie mais une conséquence.
 *
 * @param {number} id La ligne.
 * @param {object} data Les champs à changer ; ceux absents gardent leur valeur.
 * @returns {object} La ligne modifiée.
 */
export function update(id, data) {
  const existing = get("SELECT * FROM budget_lines WHERE id = ?", id);
  if (!existing) throw httpError(404, "Ligne introuvable");

  // Distingue « champ absent, on garde » de « champ envoyé, on écrase »
  const label = data.label !== undefined ? String(data.label).trim() : existing.label;
  if (!label) throw httpError(400, "Le libellé de la ligne est requis");
  const fromAcc = data.fromAccountId !== undefined ? (data.fromAccountId || null) : existing.from_account_id;
  const toAcc = data.toAccountId !== undefined ? (data.toAccountId || null) : existing.to_account_id;
  if (fromAcc && toAcc && fromAcc === toAcc) {
    throw httpError(400, "Depuis et Vers sont le même compte : un virement doit en changer (ou laissez Vers sur « extérieur »)");
  }

  const val = (key, dbKey, transform = (v) => v) =>
    data[key] !== undefined ? transform(data[key]) : existing[dbKey];

  const isPot = data.isPot !== undefined ? (data.isPot ? 1 : 0) : existing.is_pot;
  const interval = data.intervalMonths !== undefined ? Math.max(1, Number(data.intervalMonths) || 1) : (existing.interval_months || 1);
  const anchor = interval > 1
    ? (data.anchorMonth !== undefined ? (Number(data.anchorMonth) || null) : existing.anchor_month)
    : null;
  if (interval > 1 && !anchor) throw httpError(400, "Indiquez le mois d'ancrage pour une ligne non mensuelle");
  run(
    `UPDATE budget_lines SET label = ?, category_id = ?, theme_id = ?,
       planned_amount_cents = ?, from_account_id = ?, to_account_id = ?, payment_method = ?,
       is_shared = ?, recurring_day = ?, notes = ?,
       is_pot = ?, pot_partner_name = ?, pot_partner_paid_cents = ?, pot_my_share = ?, pot_line_id = ?,
       interval_months = ?, anchor_month = ?
     WHERE id = ?`,
    label,
    val("categoryId", "category_id"),
    val("themeId", "theme_id"),
    isPot ? 0 : val("plannedAmount", "planned_amount_cents", toCents),
    val("fromAccountId", "from_account_id"),
    val("toAccountId", "to_account_id"),
    val("paymentMethod", "payment_method"),
    val("isShared", "is_shared", (v) => (v ? 1 : 0)),
    val("recurringDay", "recurring_day"),
    val("notes", "notes"),
    isPot,
    val("potPartnerName", "pot_partner_name"),
    val("potPartnerPaid", "pot_partner_paid_cents", (v) => toCents(v) ?? 0),
    val("potMyShare", "pot_my_share"),
    val("potLineId", "pot_line_id"),
    interval, anchor,
    id
  );
  // Ligne mensualisée : la cible et l'échéance de l'enveloppe suivent la ligne
  const updated = get("SELECT * FROM budget_lines WHERE id = ?", id);
  if (updated.month_id === null && updated.envelope_id) {
    run("UPDATE envelopes SET name = ?, target_amount_cents = ?, deadline = ? WHERE id = ?",
      updated.label, updated.planned_amount_cents, nextDueDate(updated, currentPeriod()), updated.envelope_id);
  }

  // Ligne de mois : les champs « partagés » modifiés se propagent à TOUTES les entrées de la ligne
  // (changement de masse validé par Evan). Montants, dates et détails restent par entrée.
  if (existing.month_id) {
    if (data.themeId !== undefined && (data.themeId || null) !== existing.theme_id) {
      run("UPDATE entries SET theme_id = ? WHERE line_id = ?", data.themeId || null, id);
    }
    if (data.paymentMethod !== undefined && (data.paymentMethod || null) !== existing.payment_method) {
      run("UPDATE entries SET payment_method = ? WHERE line_id = ?", data.paymentMethod || null, id);
    }
    if (data.isShared !== undefined && (data.isShared ? 1 : 0) !== existing.is_shared) {
      run("UPDATE entries SET is_shared = ? WHERE line_id = ?", data.isShared ? 1 : 0, id);
    }
    if (data.potLineId !== undefined && (data.potLineId || null) !== existing.pot_line_id) {
      run("UPDATE entries SET pot_line_id = ? WHERE line_id = ?", data.potLineId || null, id);
    }
    // « Depuis » : jamais sur une dépense depuis enveloppe (compte hôte) ni un virement système ;
    // pour une ligne revenu, c'est le compte crédité (toAccountId) qui se propage.
    const catType = get("SELECT type FROM categories WHERE id = ?", updated.category_id)?.type || "depense";
    if (catType === "revenu") {
      if (data.toAccountId !== undefined && (data.toAccountId || null) !== existing.to_account_id && data.toAccountId) {
        run("UPDATE entries SET account_id = ? WHERE line_id = ? AND envelope_id IS NULL", data.toAccountId, id);
      }
    } else if (data.fromAccountId !== undefined && (data.fromAccountId || null) !== existing.from_account_id && data.fromAccountId) {
      run("UPDATE entries SET account_id = ? WHERE line_id = ? AND envelope_id IS NULL AND related_line_id IS NULL", data.fromAccountId, id);
    }
  }
  return getById(id);
}

// ─── Mensualisation : enveloppe liée à une ligne non mensuelle du template ───
// enabled → crée l'enveloppe (nom = libellé, cible = prévu, échéance = prochaine occurrence) sur le compte choisi
// (aucun = virtuelle sur le compte principal) ; disabled → délie (l'enveloppe reste, à clôturer si vide).
//
// À quoi ça sert : une assurance annuelle de 600 € ne se subit pas au mois d'échéance.
// Mensualisée, elle devient 50 € mis de côté chaque mois dans une enveloppe, et le
// paiement se fait sur l'argent déjà provisionné.

/** Active ou coupe la mensualisation d'une ligne du template. */
export function setMonthlyized(lineId, { enabled, accountId = null }) {
  return tx(() => setMonthlyizedInner(lineId, { enabled, accountId }));
}

function setMonthlyizedInner(lineId, { enabled, accountId = null }) {
  const line = get("SELECT * FROM budget_lines WHERE id = ? AND month_id IS NULL", lineId);
  if (!line) throw httpError(404, "Ligne du template introuvable");
  if (enabled) {
    if ((line.interval_months || 1) <= 1) throw httpError(400, "Une ligne mensuelle n'a pas besoin d'être mensualisée");
    if (line.envelope_id && get("SELECT id FROM envelopes WHERE id = ?", line.envelope_id)) return getById(lineId);
    const mainId = get("SELECT id FROM accounts WHERE is_main = 1 LIMIT 1")?.id ?? null;
    const { lastInsertRowid } = run(
      "INSERT INTO envelopes (name, account_id, target_amount_cents, deadline) VALUES (?, ?, ?, ?)",
      line.label, accountId || mainId, line.planned_amount_cents, nextDueDate(line, currentPeriod())
    );
    run("UPDATE budget_lines SET envelope_id = ? WHERE id = ?", Number(lastInsertRowid), lineId);
    // Les copies des mois OUVERTS suivent (symétrique de la désactivation) : leur ☐ payé
    // doit sortir de l'enveloppe, sinon les mois déjà créés restent démensualisés
    run(
      `UPDATE budget_lines SET envelope_id = ? WHERE template_line_id = ?
         AND month_id IN (SELECT id FROM months WHERE closed_at IS NULL)`,
      Number(lastInsertRowid), lineId
    );
  } else if (line.envelope_id) {
    const envId = line.envelope_id;
    run("UPDATE budget_lines SET envelope_id = NULL WHERE id = ?", lineId);
    // Les copies des mois ouverts suivent
    run("UPDATE budget_lines SET envelope_id = NULL WHERE template_line_id = ?", lineId);
    // L'enveloppe créée par la mensualisation part avec si elle n'a jamais vécu
    // (même règle qu'à la suppression de la ligne) ; sinon elle reste, à clôturer
    const contribs = all("SELECT kind, entry_id, amount_cents FROM envelope_contributions WHERE envelope_id = ?", envId);
    const total = contribs.reduce((s, c) => s + c.amount_cents, 0);
    const hasRealLife = contribs.some((c) => c.entry_id || c.kind === "normale" || c.kind === "depense");
    if (total === 0 && !hasRealLife) {
      run("UPDATE budget_lines SET envelope_id = NULL WHERE envelope_id = ?", envId);
      run("DELETE FROM envelope_contributions WHERE envelope_id = ?", envId);
      run("DELETE FROM envelopes WHERE id = ?", envId);
    }
  }
  return getById(lineId);
}

// orders = [{ id, order }] — l'ordre d'affichage, en une transaction pour qu'un
// glisser-déposer interrompu ne laisse pas la liste à moitié renumérotée
export function reorder(orders) {
  tx(() => {
    for (const { id, order } of orders) {
      run("UPDATE budget_lines SET sort_order = ? WHERE id = ?", order, id);
    }
  });
}

// Garde d'appartenance : les routes /months/:id/lines/:lineId vérifient l'ouverture du mois
// de l'URL — sans ce contrôle, une ligne d'un mois clôturé (ou du template) serait modifiable
// en passant l'id d'un mois ouvert (revue du 04/09)
export function assertInMonth(lineId, monthId) {
  const line = get("SELECT month_id FROM budget_lines WHERE id = ?", lineId);
  if (!line) throw httpError(404, "Ligne introuvable");
  if (line.month_id !== monthId) throw httpError(404, "Cette ligne n'appartient pas à ce mois");
}

/**
 * Ce que donnerait l'application de tout le Template sur un mois, sans rien écrire.
 *
 * Trois issues par ligne :
 *  - aucune copie dans le mois  → à créer ;
 *  - une copie sans entrée      → à mettre à jour ;
 *  - une copie déjà pointée     → ignorée si `onlyUnpaid`, sinon mise à jour.
 *
 * Les lignes non mensuelles dont le cycle ne tombe pas sur ce mois sont écartées
 * d'emblée : une charge trimestrielle n'a rien à faire dans les deux mois creux.
 *
 * @param {number} monthId Le mois visé.
 * @param {object} [options]
 * @param {boolean} [options.onlyUnpaid] Ne pas toucher aux lignes déjà pointées.
 * @returns {{month: object, toCreate: Array, toUpdate: Array, skipped: Array}}
 */
export function planApplyAll(monthId, { onlyUnpaid = true } = {}) {
  const month = get("SELECT * FROM months WHERE id = ?", monthId);
  if (!month) throw httpError(404, "Mois introuvable");
  if (month.closed_at) throw httpError(409, "Ce mois est clôturé");

  const templateLines = all("SELECT * FROM budget_lines WHERE month_id IS NULL ORDER BY sort_order, id")
    .filter((line) => cycleMatches(line, month.period));

  const toCreate = [], toUpdate = [], skipped = [];
  for (const line of templateLines) {
    const copy = get("SELECT id FROM budget_lines WHERE month_id = ? AND template_line_id = ?", monthId, line.id);
    if (!copy) { toCreate.push({ id: line.id, label: line.label }); continue; }
    const entries = get("SELECT COUNT(*) AS n FROM entries WHERE line_id = ?", copy.id).n;
    if (entries > 0 && onlyUnpaid) skipped.push({ id: line.id, label: line.label, entries });
    else toUpdate.push({ id: line.id, label: line.label });
  }
  return { month: { id: month.id, period: month.period }, toCreate, toUpdate, skipped };
}

/**
 * Applique tout le Template au mois, en une fois.
 *
 * Les cagnottes passent EN PREMIER : une ligne « ½ » pointe sur la copie de sa
 * cagnotte dans ce mois, qui doit donc déjà exister au moment où on la traite —
 * sinon son rattachement retomberait à null.
 *
 * Le tout dans une transaction : soit le mois reçoit tout le Template, soit rien.
 * Aucune entrée n'est touchée, aucun solde ne bouge.
 *
 * @param {number} monthId Le mois visé.
 * @param {object} [options]
 * @param {boolean} [options.onlyUnpaid] Ne pas toucher aux lignes déjà pointées.
 * @returns {{month: object, toCreate: Array, toUpdate: Array, skipped: Array, applied: number}}
 */
export function applyAllToMonth(monthId, { onlyUnpaid = true } = {}) {
  const plan = planApplyAll(monthId, { onlyUnpaid });
  const targets = [...plan.toCreate, ...plan.toUpdate];
  const potIds = new Set(all("SELECT id FROM budget_lines WHERE month_id IS NULL AND is_pot = 1").map((r) => r.id));
  const ordered = [
    ...targets.filter((t) => potIds.has(t.id)),
    ...targets.filter((t) => !potIds.has(t.id)),
  ];
  tx(() => { for (const t of ordered) applyToMonth(t.id, monthId); });
  return { ...plan, applied: ordered.length };
}

/**
 * Supprime une ligne — et ses entrées, qui suivent en cascade.
 *
 * Le refus quand des entrées existent n'est pas définitif : il annonce le nombre, et
 * l'appel se rejoue avec `force`. C'est une confirmation, pas un blocage — l'écran a
 * besoin du chiffre pour poser la question honnêtement.
 *
 * @param {number} id La ligne.
 * @param {object} [options]
 * @param {boolean} [options.force] Supprimer malgré les entrées.
 * @returns {{message: string}}
 */
export function remove(id, { force = false } = {}) {
  return tx(() => removeInner(id, { force }));
}

function removeInner(id, { force = false } = {}) {
  const existing = get("SELECT * FROM budget_lines WHERE id = ?", id);
  if (!existing) throw httpError(404, "Ligne introuvable");
  const entryCount = get("SELECT COUNT(*) AS n FROM entries WHERE line_id = ?", id).n;
  if (entryCount > 0 && !force) {
    throw httpError(409, `Cette ligne a ${entryCount} entrée(s) qui seront supprimées avec elle.`);
  }
  // Ligne mensualisée du template : l'enveloppe liée part avec si elle n'a jamais vécu
  // (soldée à 0, aucun versement réel ni dépense) — même règle que la suppression d'enveloppe.
  // Avec de la vraie vie, elle reste ouverte, simplement déliée.
  let suffix = "";
  if (existing.month_id === null && existing.envelope_id) {
    const envId = existing.envelope_id;
    const contribs = all("SELECT kind, entry_id, amount_cents FROM envelope_contributions WHERE envelope_id = ?", envId);
    const total = contribs.reduce((s, c) => s + c.amount_cents, 0);
    const hasRealLife = contribs.some((c) => c.entry_id || c.kind === "normale" || c.kind === "depense");
    if (total === 0 && !hasRealLife) {
      run("UPDATE budget_lines SET envelope_id = NULL WHERE envelope_id = ?", envId); // copies des mois déliées
      run("DELETE FROM envelope_contributions WHERE envelope_id = ?", envId);
      run("DELETE FROM envelopes WHERE id = ?", envId);
      suffix = " — son enveloppe vide a été supprimée avec";
    }
  }
  run("DELETE FROM budget_lines WHERE id = ?", id); // les entrées suivent (CASCADE)
  return { message: "Ligne supprimée" + suffix };
}

/**
 * « Appliquer au mois » : la ligne du template est copiée dans un mois (ou sa copie mise à jour).
 *
 * Le réel du mois n'est jamais touché ; seule la définition de la ligne est propagée.
 * Le rattachement de cagnotte est **retraduit** au passage : la copie doit pointer vers
 * la cagnotte DE CE MOIS, pas vers celle du template — sinon le calcul du partage irait
 * lire des montants qui ne concernent pas ce mois.
 *
 * @param {number} templateLineId La ligne du template.
 * @param {number} monthId Le mois destinataire, ouvert.
 * @returns {object} La ligne du mois, avec `created` selon qu'elle vient de naître.
 */
export function applyToMonth(templateLineId, monthId) {
  const tpl = get("SELECT * FROM budget_lines WHERE id = ? AND month_id IS NULL", templateLineId);
  if (!tpl) throw httpError(404, "Ligne du template introuvable");
  const month = get("SELECT * FROM months WHERE id = ?", monthId);
  if (!month) throw httpError(404, "Mois introuvable");
  if (month.closed_at) throw httpError(409, "Ce mois est clôturé");

  // Cagnotte par défaut des ½ : on vise la copie de la cagnotte dans ce mois, si elle existe
  const potCopy = tpl.pot_line_id
    ? get("SELECT id FROM budget_lines WHERE month_id = ? AND template_line_id = ?", monthId, tpl.pot_line_id)?.id ?? null
    : null;

  const copy = get("SELECT * FROM budget_lines WHERE month_id = ? AND template_line_id = ?", monthId, tpl.id);
  if (copy) {
    run(
      `UPDATE budget_lines SET label = ?, category_id = ?, theme_id = ?, planned_amount_cents = ?,
         from_account_id = ?, to_account_id = ?, payment_method = ?, is_shared = ?, recurring_day = ?,
         is_pot = ?, pot_partner_name = ?, pot_partner_paid_cents = ?, pot_my_share = ?, pot_line_id = ?,
         interval_months = ?, anchor_month = ?, envelope_id = ? WHERE id = ?`,
      tpl.label, tpl.category_id, tpl.theme_id, tpl.planned_amount_cents,
      tpl.from_account_id, tpl.to_account_id, tpl.payment_method, tpl.is_shared, tpl.recurring_day,
      tpl.is_pot, tpl.pot_partner_name, tpl.pot_partner_paid_cents, tpl.pot_my_share, potCopy,
      tpl.interval_months || 1, tpl.anchor_month, tpl.envelope_id, copy.id
    );
    return { ...getById(copy.id), created: false };
  }

  const max = get("SELECT COALESCE(MAX(sort_order), -1) AS m FROM budget_lines WHERE month_id = ?", monthId).m;
  const { lastInsertRowid } = run(
    `INSERT INTO budget_lines
      (month_id, template_line_id, label, category_id, theme_id, planned_amount_cents,
       from_account_id, to_account_id, payment_method, is_shared, recurring_day, sort_order, notes,
       is_pot, pot_partner_name, pot_partner_paid_cents, pot_my_share, pot_line_id,
       interval_months, anchor_month, envelope_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    monthId, tpl.id, tpl.label, tpl.category_id, tpl.theme_id, tpl.planned_amount_cents,
    tpl.from_account_id, tpl.to_account_id, tpl.payment_method, tpl.is_shared, tpl.recurring_day, max + 1, tpl.notes,
    tpl.is_pot, tpl.pot_partner_name, tpl.pot_partner_paid_cents, tpl.pot_my_share, potCopy,
    tpl.interval_months || 1, tpl.anchor_month, tpl.envelope_id
  );
  return { ...getById(Number(lastInsertRowid)), created: true };
}

/**
 * « Reporter dans le template » : la ligne du mois devient le nouveau standard.
 *
 * Le geste du mois où l'on constate que le loyer a changé pour de bon. Ne remontent que
 * les champs de DÉFINITION : ni les notes, ni la périodicité, ni l'enveloppe liée —
 * ceux-là se règlent depuis l'écran Template, où l'on voit les conséquences.
 *
 * @param {number} id La ligne de mois.
 * @returns {object} La ligne du template mise à jour.
 */
export function applyToTemplate(id) {
  const line = get("SELECT * FROM budget_lines WHERE id = ?", id);
  if (!line) throw httpError(404, "Ligne introuvable");
  if (!line.month_id) throw httpError(400, "Cette ligne est déjà dans le template");
  if (!line.template_line_id) throw httpError(400, "Ligne propre à ce mois : ajoutez-la au template depuis l'écran Template");
  const template = get("SELECT * FROM budget_lines WHERE id = ? AND month_id IS NULL", line.template_line_id);
  if (!template) throw httpError(404, "La ligne d'origine n'existe plus dans le template");

  run(
    `UPDATE budget_lines SET label = ?, category_id = ?, theme_id = ?,
       planned_amount_cents = ?, from_account_id = ?, to_account_id = ?, payment_method = ?,
       is_shared = ?, recurring_day = ?,
       is_pot = ?, pot_partner_name = ?, pot_partner_paid_cents = ?, pot_my_share = ? WHERE id = ?`,
    line.label, line.category_id, line.theme_id,
    line.planned_amount_cents, line.from_account_id, line.to_account_id, line.payment_method,
    line.is_shared, line.recurring_day,
    line.is_pot, line.pot_partner_name, line.pot_partner_paid_cents, line.pot_my_share, template.id
  );
  return getById(template.id);
}
