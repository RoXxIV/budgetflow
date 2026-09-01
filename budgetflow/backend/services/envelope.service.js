import { all, get, run, tx, toCents, fromCents, httpError } from "../db/index.js";

// Mois calendaires restants jusqu'à l'échéance (0 si dépassée)
function monthsUntil(deadline) {
  const now = new Date();
  const end = new Date(deadline);
  return (end.getFullYear() - now.getFullYear()) * 12 + (end.getMonth() - now.getMonth());
}

// Mensualité suggérée = (cible − total) / mois restants ; null sans cible ou sans échéance
function monthlySuggestion(targetCents, totalCents, deadline) {
  if (!targetCents || !deadline) return null;
  const remaining = targetCents - (totalCents || 0);
  if (remaining <= 0) return 0;
  const months = Math.max(1, monthsUntil(deadline));
  return fromCents(Math.ceil(remaining / months));
}

function serialize(row) {
  // Dépenses du projet (contributions « depense » comptées dans l'objectif) : la cible affichée en est corrigée
  const spentInTarget = -(row.spent_in_target_cents ?? 0);
  const effectiveTarget = row.target_amount_cents ? row.target_amount_cents - spentInTarget : null;
  return {
    id: row.id,
    name: row.name,
    accountId: row.account_id,
    accountName: row.account_name ?? null,
    targetAmount: fromCents(row.target_amount_cents),
    spentInTarget: fromCents(spentInTarget),
    effectiveTarget: fromCents(effectiveTarget),
    deadline: row.deadline,
    total: fromCents(row.total_cents ?? 0),
    monthlySuggestion: monthlySuggestion(effectiveTarget, row.total_cents, row.deadline),
    isClosed: !!row.closed_at,
    createdAt: row.created_at,
  };
}

// Une contribution datée dans un mois clôturé est refusée (les saisies y sont verrouillées)
function assertPeriodOpen(date) {
  const month = get("SELECT * FROM months WHERE period = ?", String(date).substring(0, 7));
  if (month?.closed_at) throw httpError(409, `La date ${String(date).substring(0, 10)} tombe dans ${month.period}, un mois clôturé : changez la date, ou rouvrez ce mois pour y saisir`);
}

const LIST_SQL = `
  SELECT e.*, a.name AS account_name,
    COALESCE((SELECT SUM(c.amount_cents) FROM envelope_contributions c WHERE c.envelope_id = e.id), 0) AS total_cents,
    COALESCE((SELECT SUM(c.amount_cents) FROM envelope_contributions c WHERE c.envelope_id = e.id AND c.kind = 'depense' AND c.in_target = 1), 0) AS spent_in_target_cents
  FROM envelopes e
  LEFT JOIN accounts a ON a.id = e.account_id
`;

export function list() {
  return all(`${LIST_SQL} ORDER BY e.closed_at IS NOT NULL, e.name`).map(serialize);
}

export function getById(id) {
  const row = get(`${LIST_SQL} WHERE e.id = ?`, id);
  if (!row) throw httpError(404, "Enveloppe introuvable");
  return serialize(row);
}

// ─── Invariant : Σ enveloppes ouvertes d'un compte ≤ solde du compte ───
// Disponible « hors enveloppes » d'un compte sur le mois en cours (null si le solde est inconnu)
export function availability(accountId) {
  const account = get("SELECT * FROM accounts WHERE id = ?", accountId);
  if (!account) throw httpError(404, "Compte introuvable");
  const month = get("SELECT * FROM months WHERE closed_at IS NULL ORDER BY period DESC LIMIT 1")
    || get("SELECT * FROM months ORDER BY period DESC LIMIT 1");
  const envelopesTotal = fromCents(get(
    `SELECT COALESCE(SUM(c.amount_cents), 0) AS s FROM envelopes e
     LEFT JOIN envelope_contributions c ON c.envelope_id = e.id
     WHERE e.account_id = ? AND e.closed_at IS NULL`, accountId
  ).s);
  let balance = null;
  if (month && _summary) {
    balance = _summary.getSummary(month.id).accounts.find((a) => a.accountId === accountId)?.current ?? null;
  }
  return {
    accountId,
    accountName: account.name,
    balance,
    envelopesTotal,
    available: balance === null ? null : Math.round((balance - envelopesTotal) * 100) / 100,
    allowOverdraft: !!account.allow_overdraft,
    monthPeriod: month?.period ?? null,
  };
}

// Refuse un ajout virtuel qui dépasserait le disponible hors enveloppes (solde connu uniquement).
// Un compte à découvert autorisé n'est pas bloqué : son hors-enveloppes peut être négatif (affiché en ambre).
function assertAvailable(accountId, cents, what = "Le montant") {
  if (!accountId || !cents || cents <= 0) return;
  if (get("SELECT allow_overdraft FROM accounts WHERE id = ?", accountId)?.allow_overdraft) return;
  const a = availability(accountId);
  if (a.available === null) return; // solde inconnu : pas de contrôle possible
  if (cents > toCents(a.available)) {
    throw httpError(409,
      `${what} (${fromCents(cents).toLocaleString("fr-FR", { minimumFractionDigits: 2 })} €) dépasse le disponible hors enveloppes de ${a.accountName} ` +
      `(${a.available.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} €). Prenez dans une autre enveloppe du compte, ou recalez le compte.`);
  }
}

// Deux enveloppes ouvertes du même nom au même endroit = confusion garantie (les clôturées ne bloquent pas)
function assertNameFree(name, accountId, excludeId = null) {
  const dup = get(
    "SELECT id FROM envelopes WHERE closed_at IS NULL AND lower(name) = lower(?) AND COALESCE(account_id, 0) = COALESCE(?, 0) AND id != COALESCE(?, -1)",
    name, accountId, excludeId
  );
  if (dup) {
    throw httpError(409, `Une enveloppe « ${name} » existe déjà ${accountId ? "sur ce compte" : "en virtuelle"} : choisissez un autre nom (ou clôturez l'autre)`);
  }
}

export function create({ name, accountId = null, targetAmount = null, deadline = null, initialAmount = null, fromEnvelopeId = null }) {
  name = (name || "").trim();
  if (!name) throw httpError(400, "Le nom de l'enveloppe est requis");
  assertNameFree(name, accountId);
  const cents = toCents(initialAmount);

  // Montant initial : soit pris dans une autre enveloppe du même compte (réaffectation), soit sur le disponible
  let source = null;
  if (cents && fromEnvelopeId) {
    source = get("SELECT * FROM envelopes WHERE id = ? AND closed_at IS NULL", fromEnvelopeId);
    if (!source) throw httpError(404, "Enveloppe source introuvable");
    if (!accountId || source.account_id !== accountId) throw httpError(400, "La réaffectation ne se fait qu'entre enveloppes d'un même compte");
    const sourceTotal = get("SELECT COALESCE(SUM(amount_cents), 0) AS s FROM envelope_contributions WHERE envelope_id = ?", source.id).s;
    if (cents > sourceTotal) throw httpError(409, `« ${source.name} » ne contient que ${fromCents(sourceTotal).toLocaleString("fr-FR", { minimumFractionDigits: 2 })} €`);
  } else if (cents && accountId) {
    assertAvailable(accountId, cents, "Le montant initial");
  }

  return tx(() => {
    const { lastInsertRowid: id } = run(
      "INSERT INTO envelopes (name, account_id, target_amount_cents, deadline) VALUES (?, ?, ?, ?)",
      name, accountId, toCents(targetAmount), deadline || null
    );
    if (cents) {
      if (source) {
        run("INSERT INTO envelope_contributions (envelope_id, amount_cents, kind, notes) VALUES (?, ?, 'reaffectation', ?)",
          source.id, -cents, `Réaffecté vers « ${name} »`);
        run("INSERT INTO envelope_contributions (envelope_id, amount_cents, kind, notes) VALUES (?, ?, 'reaffectation', ?)",
          id, cents, `Pris dans « ${source.name} »`);
      } else {
        run("INSERT INTO envelope_contributions (envelope_id, amount_cents, kind, notes) VALUES (?, ?, 'initiale', ?)",
          id, cents, "Montant initial");
      }
    }
    return getById(Number(id));
  });
}

// Réaffectation entre deux enveloppes ouvertes d'un même compte (une saisie, deux contributions liées)
export function reallocate(fromId, { toEnvelopeId, amount, notes = null }) {
  const from = get("SELECT * FROM envelopes WHERE id = ? AND closed_at IS NULL", fromId);
  const to = get("SELECT * FROM envelopes WHERE id = ? AND closed_at IS NULL", toEnvelopeId);
  if (!from || !to) throw httpError(404, "Enveloppe introuvable ou clôturée");
  if (from.id === to.id) throw httpError(400, "Même enveloppe");
  if (!from.account_id || from.account_id !== to.account_id) throw httpError(400, "La réaffectation ne se fait qu'entre enveloppes d'un même compte");
  const cents = toCents(amount);
  if (!cents || cents <= 0) throw httpError(400, "Montant requis (positif)");
  const fromTotal = get("SELECT COALESCE(SUM(amount_cents), 0) AS s FROM envelope_contributions WHERE envelope_id = ?", from.id).s;
  if (cents > fromTotal) throw httpError(409, `« ${from.name} » ne contient que ${fromCents(fromTotal).toLocaleString("fr-FR", { minimumFractionDigits: 2 })} €`);
  assertPeriodOpen(new Date().toISOString());
  tx(() => {
    run("INSERT INTO envelope_contributions (envelope_id, amount_cents, kind, notes) VALUES (?, ?, 'reaffectation', ?)",
      from.id, -cents, notes || `Réaffecté vers « ${to.name} »`);
    run("INSERT INTO envelope_contributions (envelope_id, amount_cents, kind, notes) VALUES (?, ?, 'reaffectation', ?)",
      to.id, cents, notes || `Pris dans « ${from.name} »`);
  });
  return { from: getById(from.id), to: getById(to.id) };
}

export function update(id, data) {
  const existing = get("SELECT * FROM envelopes WHERE id = ?", id);
  if (!existing) throw httpError(404, "Enveloppe introuvable");

  return tx(() => {
    const name = data.name !== undefined ? String(data.name).trim() : existing.name;
    if (!name) throw httpError(400, "Le nom de l'enveloppe est requis");
    const accountId = data.accountId !== undefined ? data.accountId : existing.account_id;
    assertNameFree(name, accountId, id);
    const target = data.targetAmount !== undefined ? toCents(data.targetAmount) : existing.target_amount_cents;
    const deadline = data.deadline !== undefined ? (data.deadline || null) : existing.deadline;
    const closedAt = data.isClosed !== undefined
      ? (data.isClosed ? (existing.closed_at || new Date().toISOString()) : null)
      : existing.closed_at;

    run("UPDATE envelopes SET name = ?, account_id = ?, target_amount_cents = ?, deadline = ?, closed_at = ? WHERE id = ?",
      name, accountId, target, deadline, closedAt, id);

    // Changement de compte hôte avec de l'argent dedans : l'argent doit physiquement suivre
    // → virement système ancien hôte → nouvel hôte (une enveloppe virtuelle « attend » sur le compte principal)
    if (data.accountId !== undefined && (accountId || null) !== existing.account_id) {
      const total = get("SELECT COALESCE(SUM(amount_cents), 0) AS s FROM envelope_contributions WHERE envelope_id = ?", id).s;
      if (total > 0) {
        const mainId = get("SELECT id FROM accounts WHERE is_main = 1 LIMIT 1")?.id ?? null;
        const oldHost = existing.account_id ?? mainId;
        const newHost = accountId ?? mainId;
        if (oldHost && newHost && oldHost !== newHost) {
          const month = get("SELECT * FROM months WHERE closed_at IS NULL ORDER BY period DESC LIMIT 1");
          if (!month) throw httpError(409, "Aucun mois ouvert pour enregistrer le virement de déplacement de l'enveloppe");
          const accName = (aid) => get("SELECT name FROM accounts WHERE id = ?", aid)?.name || "?";
          run(
            `INSERT INTO entries (month_id, label, amount_cents, account_id, to_account_id, source)
             VALUES (?, ?, ?, ?, ?, 'manuelle')`,
            month.id, `Enveloppe « ${name} » déplacée : ${accName(oldHost)} → ${accName(newHost)}`,
            total, oldHost, newHost
          );
        }
      }
    }

    // Renommage synchronisé inverse : l'enveloppe est seule sur son compte et portait son nom
    if (name !== existing.name && existing.account_id) {
      const account = get("SELECT * FROM accounts WHERE id = ?", existing.account_id);
      const siblings = get("SELECT COUNT(*) AS n FROM envelopes WHERE account_id = ? AND closed_at IS NULL", existing.account_id).n;
      if (account && siblings === 1 && account.name === existing.name) {
        run("UPDATE accounts SET name = ? WHERE id = ?", name, account.id);
      }
    }
    return getById(id);
  });
}

// Suppression définitive : réservée à une enveloppe SANS historique (créée par erreur).
// Avec un historique, la voie est la clôture — seule, ou en réaffectant le contenu (closeInto).
export function remove(id) {
  const existing = get("SELECT * FROM envelopes WHERE id = ?", id);
  if (!existing) throw httpError(404, "Enveloppe introuvable");

  const linked = get("SELECT label FROM budget_lines WHERE envelope_id = ? AND month_id IS NULL LIMIT 1", id);
  if (linked) {
    throw httpError(409, `Cette enveloppe alimente la ligne mensualisée « ${linked.label} » : démensualisez la ligne d'abord (template).`);
  }

  const total = get("SELECT COALESCE(SUM(amount_cents), 0) AS s FROM envelope_contributions WHERE envelope_id = ?", id).s;
  const n = get("SELECT COUNT(*) AS n FROM envelope_contributions WHERE envelope_id = ?", id).n;
  if (n > 0) {
    const err = httpError(409, `« ${existing.name} » a un historique de ${n} contribution(s) pour un total de ${fromCents(total).toLocaleString("fr-FR", { minimumFractionDigits: 2 })} € : clôturez-la (l'historique reste)`);
    err.payload = { code: "ENVELOPE_HAS_FUNDS", total: fromCents(total), contributions: n, accountId: existing.account_id };
    throw err;
  }

  run("DELETE FROM envelopes WHERE id = ?", id);
  return { message: "Enveloppe supprimée" };
}

// Clôturer en réaffectant tout le contenu : vers n'importe quelle enveloppe ouverte, ou vers le
// « hors enveloppes » d'un compte actif. L'historique est conservé (contribution négative tracée) ;
// si l'argent change de compte hôte, un virement système suit dans le mois ouvert.
export function closeInto(id, { toEnvelopeId = null, toAccountId = null } = {}) {
  const existing = get("SELECT * FROM envelopes WHERE id = ?", id);
  if (!existing) throw httpError(404, "Enveloppe introuvable");
  if (existing.closed_at) throw httpError(409, "Enveloppe déjà clôturée");
  const linked = get("SELECT label FROM budget_lines WHERE envelope_id = ? AND month_id IS NULL LIMIT 1", id);
  if (linked) {
    throw httpError(409, `Cette enveloppe alimente la ligne mensualisée « ${linked.label} » : démensualisez la ligne d'abord (template).`);
  }

  const total = get("SELECT COALESCE(SUM(amount_cents), 0) AS s FROM envelope_contributions WHERE envelope_id = ?", id).s;
  const mainId = get("SELECT id FROM accounts WHERE is_main = 1 LIMIT 1")?.id ?? null;
  const hostSrc = existing.account_id ?? mainId;

  return tx(() => {
    if (total > 0) {
      let hostDst = null;
      if (toEnvelopeId) {
        const target = get("SELECT * FROM envelopes WHERE id = ? AND closed_at IS NULL", toEnvelopeId);
        if (!target || target.id === id) throw httpError(400, "Enveloppe destinataire invalide");
        hostDst = target.account_id ?? mainId;
        run("INSERT INTO envelope_contributions (envelope_id, amount_cents, kind, notes) VALUES (?, ?, 'reaffectation', ?)",
          id, -total, `Réaffecté vers « ${target.name} » (clôture)`);
        run("INSERT INTO envelope_contributions (envelope_id, amount_cents, kind, notes) VALUES (?, ?, 'reaffectation', ?)",
          target.id, total, `Pris dans « ${existing.name} » (clôturée)`);
      } else if (toAccountId) {
        const account = get("SELECT * FROM accounts WHERE id = ? AND is_active = 1", toAccountId);
        if (!account) throw httpError(400, "Compte destinataire invalide");
        hostDst = account.id;
        run("INSERT INTO envelope_contributions (envelope_id, amount_cents, kind, notes) VALUES (?, ?, 'reaffectation', ?)",
          id, -total, `Libéré vers « ${account.name} » (clôture)`);
      } else {
        throw httpError(400, "Destination requise (enveloppe ou compte)");
      }

      // L'argent change de compte : virement système pour que l'historique bancaire colle
      if (hostSrc && hostDst && hostSrc !== hostDst) {
        const month = get("SELECT * FROM months WHERE closed_at IS NULL ORDER BY period DESC LIMIT 1");
        if (!month) throw httpError(409, "Aucun mois ouvert pour enregistrer le virement de réaffectation");
        const accName = (aid) => get("SELECT name FROM accounts WHERE id = ?", aid)?.name || "?";
        run(
          `INSERT INTO entries (month_id, label, amount_cents, account_id, to_account_id, source)
           VALUES (?, ?, ?, ?, ?, 'manuelle')`,
          month.id, `Enveloppe « ${existing.name} » réaffectée : ${accName(hostSrc)} → ${accName(hostDst)}`,
          total, hostSrc, hostDst
        );
      }
    }
    run("UPDATE envelopes SET closed_at = ? WHERE id = ?", new Date().toISOString(), id);
    return getById(id);
  });
}

// ─── Contributions ────────────────────────────────────────
// Contributions de toutes les enveloppes datées dans un mois ('YYYY-MM')
export function listContributionsByPeriod(period) {
  const start = `${period}-01`;
  return all(
    `SELECT c.*, e.name AS envelope_name, a.name AS from_account_name
     FROM envelope_contributions c
     JOIN envelopes e ON e.id = c.envelope_id
     LEFT JOIN accounts a ON a.id = c.from_account_id
     WHERE c.date >= ? AND c.date < date(?, '+1 month')
     ORDER BY c.date DESC, c.id DESC`, start, start
  ).map((c) => ({
    id: c.id,
    envelopeId: c.envelope_id,
    envelopeName: c.envelope_name,
    amount: fromCents(c.amount_cents),
    date: c.date,
    kind: c.kind,
    fromAccountId: c.from_account_id,
    fromAccountName: c.from_account_name ?? null,
    entryId: c.entry_id,
    inTarget: !!c.in_target,
    notes: c.notes,
  }));
}

export function listContributions(envelopeId) {
  return all(
    `SELECT c.*, a.name AS from_account_name FROM envelope_contributions c
     LEFT JOIN accounts a ON a.id = c.from_account_id
     WHERE c.envelope_id = ? ORDER BY c.date DESC, c.id DESC`, envelopeId
  ).map((c) => ({
    id: c.id,
    envelopeId: c.envelope_id,
    amount: fromCents(c.amount_cents),
    date: c.date,
    kind: c.kind,
    fromAccountId: c.from_account_id,
    fromAccountName: c.from_account_name ?? null,
    entryId: c.entry_id,
    inTarget: !!c.in_target,
    notes: c.notes,
  }));
}

// ─── Dépense depuis une enveloppe, liée à une entrée du mois ───
// Appelé après création / modification d'une entrée : crée, met à jour ou retire la contribution « depense ».
export function syncEntryExpense(entry) {
  const existing = get("SELECT * FROM envelope_contributions WHERE entry_id = ?", entry.id);
  if (!entry.envelope_id) {
    if (existing) run("DELETE FROM envelope_contributions WHERE id = ?", existing.id);
    return;
  }
  const envelope = get("SELECT * FROM envelopes WHERE id = ?", entry.envelope_id);
  if (!envelope) return;
  const notes = entry.label || get("SELECT label FROM budget_lines WHERE id = ?", entry.line_id)?.label || "Dépense depuis l'enveloppe";
  if (existing) {
    run(
      "UPDATE envelope_contributions SET envelope_id = ?, amount_cents = ?, date = ?, in_target = ?, notes = ? WHERE id = ?",
      envelope.id, -entry.amount_cents, entry.date, entry.envelope_in_target ? 1 : 0, notes, existing.id
    );
  } else {
    run(
      "INSERT INTO envelope_contributions (envelope_id, amount_cents, date, kind, entry_id, in_target, notes) VALUES (?, ?, ?, 'depense', ?, ?, ?)",
      envelope.id, -entry.amount_cents, entry.date, entry.id, entry.envelope_in_target ? 1 : 0, notes
    );
  }
}

export function addContribution(envelopeId, { amount, date = null, kind = "normale", fromAccountId = null, notes = null }) {
  const envelope = get("SELECT * FROM envelopes WHERE id = ?", envelopeId);
  if (!envelope) throw httpError(404, "Enveloppe introuvable");
  if (envelope.closed_at) throw httpError(409, "Enveloppe clôturée");
  const cents = toCents(amount);
  if (!cents) throw httpError(400, "Montant requis");
  assertPeriodOpen(date || new Date().toISOString());
  // Ajout virtuel (pas de compte source, ou source = compte hôte) : plafonné au disponible hors enveloppes.
  // Un transfert réel depuis un autre compte augmente aussi le solde → pas de plafond.
  // Les ajustements (recalage) et réaffectations sont les voies sanctionnées, exemptées.
  if (kind === "normale" && envelope.account_id && (!fromAccountId || fromAccountId === envelope.account_id)) {
    assertAvailable(envelope.account_id, cents, "La contribution");
  }
  run(
    "INSERT INTO envelope_contributions (envelope_id, amount_cents, date, kind, from_account_id, notes) VALUES (?, ?, COALESCE(?, date('now')), ?, ?, ?)",
    envelopeId, cents, date, kind, fromAccountId, notes
  );
  return getById(envelopeId);
}

// ─── Recalage : aligner les enveloppes d'un compte sur son solde réel ───
// delta = solde live du compte − Σ enveloppes ouvertes hébergées ; posé en contribution « ajustement »
// sur l'enveloppe choisie (intérêts, arrondis, sortie non enregistrée…). Historique conservé.
export function recalibrationPreview(envelopeId) {
  const envelope = get("SELECT * FROM envelopes WHERE id = ?", envelopeId);
  if (!envelope) throw httpError(404, "Enveloppe introuvable");
  if (!envelope.account_id) throw httpError(400, "Enveloppe virtuelle : pas de compte à comparer");
  const month = get("SELECT * FROM months WHERE closed_at IS NULL ORDER BY period DESC LIMIT 1")
    || get("SELECT * FROM months ORDER BY period DESC LIMIT 1");
  if (!month) throw httpError(400, "Aucun mois : pas de solde de compte connu");
  const { getSummary } = summaryModule();
  const account = getSummary(month.id).accounts.find((a) => a.accountId === envelope.account_id);
  if (!account || account.current === null) throw httpError(400, "Solde du compte inconnu (saisir le solde de début de mois)");
  return {
    envelopeId: envelope.id,
    accountName: account.name,
    accountBalance: account.current,
    envelopesTotal: account.envelopesTotal,
    delta: Math.round((account.current - account.envelopesTotal) * 100) / 100,
    monthPeriod: month.period,
  };
}

export function recalibrate(envelopeId, { notes = null } = {}) {
  const preview = recalibrationPreview(envelopeId);
  const cents = toCents(preview.delta);
  if (!cents) throw httpError(400, "Déjà aligné sur le solde du compte");
  return addContribution(envelopeId, {
    amount: preview.delta,
    kind: "ajustement",
    notes: notes || `Recalage sur le solde de ${preview.accountName} (${preview.monthPeriod})`,
  });
}

let _summary = null;
function summaryModule() {
  // Chargé à la demande : summary.service importe aussi ce module (dépendance circulaire)
  if (!_summary) throw httpError(500, "summary non initialisé");
  return _summary;
}
export function bindSummary(mod) { _summary = mod; }

export function removeContribution(envelopeId, contributionId) {
  const c = get("SELECT * FROM envelope_contributions WHERE id = ? AND envelope_id = ?", contributionId, envelopeId);
  if (!c) throw httpError(404, "Contribution introuvable");
  if (c.entry_id) throw httpError(409, "Cette dépense est liée à une entrée du mois : modifiez ou supprimez l'entrée");
  assertPeriodOpen(c.date);
  run("DELETE FROM envelope_contributions WHERE id = ?", contributionId);
  return getById(envelopeId);
}
