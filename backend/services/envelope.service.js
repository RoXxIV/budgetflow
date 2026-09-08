// Les enveloppes : de l'argent mis de côté à l'intérieur d'un compte, pour un projet.
//
// L'IDÉE — une enveloppe ne détient pas d'argent, elle en **réserve**. Les 3 000 € du
// projet « voyage » dorment sur le Livret A comme le reste ; l'enveloppe dit seulement
// qu'ils ne sont pas disponibles. D'où l'invariant qui gouverne tout ce fichier :
//
//     Σ des enveloppes ouvertes d'un compte  ≤  solde de ce compte
//
// Une enveloppe sans compte hôte est dite **virtuelle** : le projet existe, l'argent
// n'est pas encore rangé quelque part.
//
// JAMAIS DE PERTE — une enveloppe qui a vécu ne se supprime pas, elle se **clôture**,
// et son contenu part explicitement ailleurs (`closeInto`). `remove` est réservé à
// celles créées par erreur : rien dedans, aucun historique réel.
//
// L'ARGENT SUIT — dès qu'une opération déplace une réserve d'un compte vers un autre
// (changement d'hôte, réaffectation, liquidation), un **virement système** est écrit
// dans le mois ouvert. Sans lui, les soldes affichés cesseraient de correspondre aux
// relevés bancaires.

import { all, get, run, tx, toCents, fromCents, httpError } from "../db/index.js";
import { nextDueDate } from "./budgetLine.service.js";

// Mois calendaires restants jusqu'à l'échéance (négatif si dépassée)
// L'échéance se raisonne au mois : le jour n'entre dans aucun calcul. La chaîne ISO est
// découpée telle quelle plutôt que passée à new Date(), qui la lirait en UTC et pourrait
// la faire basculer d'un mois selon le fuseau.
function monthsUntil(deadline) {
  const now = new Date();
  const [year, month] = String(deadline).split("-").map(Number);
  return (year - now.getFullYear()) * 12 + (month - 1 - now.getMonth());
}

// Mensualité suggérée = (cible − total) / mois restants ; null sans cible ou sans échéance
// L'arrondi est au centime SUPÉRIEUR : arrondir au plus proche ferait manquer la cible
// de quelques centimes au dernier versement, ce qui se voit et se comprend mal.
// Une échéance dépassée retombe sur 1 mois — on demande le reste tout de suite.
function monthlySuggestion(targetCents, totalCents, deadline) {
  if (!targetCents || !deadline) return null;
  const remaining = targetCents - (totalCents || 0);
  if (remaining <= 0) return 0;
  const months = Math.max(1, monthsUntil(deadline));
  return fromCents(Math.ceil(remaining / months));
}

/**
 * Met une ligne de base en forme d'API : centimes → euros, snake_case → camelCase.
 *
 * Une subtilité s'y joue, la **cible effective**. Quand une dépense du projet a déjà
 * été payée depuis l'enveloppe et comptée dans l'objectif (`in_target`), elle ne
 * disparaît pas de l'effort à fournir : la cible affichée est relevée d'autant. Un
 * voyage à 3 000 € dont 500 € d'acompte sont déjà partis demande encore 3 000 € de
 * mise de côté, pas 2 500 — sans quoi l'enveloppe se croirait remplie trop tôt.
 *
 * @param {object} row Ligne issue de LIST_SQL (avec ses totaux calculés).
 * @returns {object} L'enveloppe telle que l'API l'expose.
 */
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
    deadlineMonths: monthsFromDeadline(row.deadline),
    total: fromCents(row.total_cents ?? 0),
    monthlySuggestion: monthlySuggestion(effectiveTarget, row.total_cents, row.deadline),
    isClosed: !!row.closed_at,
    // Enveloppe d'une ligne mensualisée du template : le front lui propose « Liquider et renouveler »
    linkedTemplateLineId: row.linked_line_id ?? null,
    createdAt: row.created_at,
  };
}

// Une contribution datée dans un mois clôturé est refusée (les saisies y sont verrouillées)
function assertPeriodOpen(date) {
  const month = get("SELECT * FROM months WHERE period = ?", String(date).substring(0, 7));
  if (month?.closed_at) throw httpError(409, `La date ${String(date).substring(0, 10)} tombe dans ${month.period}, un mois clôturé : changez la date, ou rouvrez ce mois pour y saisir`);
}

// Le total d'une enveloppe n'est jamais stocké : il est toujours la somme de ses
// contributions. Rien à resynchroniser, donc rien qui puisse se désynchroniser.
const LIST_SQL = `
  SELECT e.*, a.name AS account_name,
    COALESCE((SELECT SUM(c.amount_cents) FROM envelope_contributions c WHERE c.envelope_id = e.id), 0) AS total_cents,
    COALESCE((SELECT SUM(c.amount_cents) FROM envelope_contributions c WHERE c.envelope_id = e.id AND c.kind = 'depense' AND c.in_target = 1), 0) AS spent_in_target_cents,
    (SELECT b.id FROM budget_lines b WHERE b.envelope_id = e.id AND b.month_id IS NULL LIMIT 1) AS linked_line_id
  FROM envelopes e
  LEFT JOIN accounts a ON a.id = e.account_id
`;

// Toutes les enveloppes, les ouvertes d'abord, chaque groupe par ordre alphabétique
export function list() {
  return all(`${LIST_SQL} ORDER BY e.closed_at IS NOT NULL, e.name`).map(serialize);
}

// ─── Échéance saisie en nombre de mois ────────────────────
// Le formulaire demande « dans combien de mois ? » plutôt qu'une date : on épargne
// pour un mois, jamais pour un jour précis. La base, elle, stocke une date — le 1er du
// mois visé, par convention.

/**
 * Convertit un nombre de mois en date d'échéance.
 *
 * @param {number} months 0 pour le mois en cours, 1 pour le suivant, etc.
 * @returns {string} Le 1er du mois visé, au format ISO.
 */
export function deadlineFromMonths(months) {
  const n = Number(months);
  if (!Number.isInteger(n) || n < 0) throw httpError(400, "Le nombre de mois doit être un entier positif ou nul");
  if (n > 600) throw httpError(400, "Échéance trop lointaine : 600 mois au maximum");
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth() + n, 1);
  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, "0")}-01`;
}

// Échéance existante → nombre de mois restants, pour repeupler le champ à l'édition
export function monthsFromDeadline(deadline) {
  if (!deadline) return null;
  return Math.max(0, monthsUntil(deadline));
}

/**
 * Simulation « cible X en N mois » : échéance et mensualité, sans rien écrire en base.
 *
 * Sert au formulaire, qui essaie plusieurs réglages avant de valider — la formule de la
 * mensualité reste ici, le front ne fait que l'afficher.
 *
 * Sur une enveloppe existante, le déjà-versé et les dépenses imputées sont **relus en
 * base** plutôt que repris du client : une simulation partant de chiffres envoyés par
 * le navigateur pourrait annoncer une mensualité qui ne correspond à rien.
 *
 * @param {object} [params]
 * @param {number|null} [params.targetAmount] La cible visée, en euros.
 * @param {number|null} [params.months] Le délai voulu.
 * @param {number|null} [params.currentTotal] Mise de départ, pour une enveloppe à créer.
 * @param {number|null} [params.envelopeId] Enveloppe existante : ses chiffres priment.
 * @returns {object} Échéance, reste à réunir et mensualité suggérée.
 */
export function simulate({ targetAmount = null, months = null, currentTotal = null, envelopeId = null } = {}) {
  const deadline = months === null || months === "" ? null : deadlineFromMonths(months);

  let totalCents = toCents(currentTotal) || 0;
  let spentInTargetCents = 0;
  if (envelopeId) {
    // Enveloppe existante : le déjà-versé et les dépenses imputées viennent de la base, pas du client
    const row = get(`${LIST_SQL} WHERE e.id = ?`, envelopeId);
    if (!row) throw httpError(404, "Enveloppe introuvable");
    totalCents = row.total_cents ?? 0;
    spentInTargetCents = -(row.spent_in_target_cents ?? 0);
  }
  if (totalCents < 0) throw httpError(400, "Le montant de départ doit être positif");

  const targetCents = toCents(targetAmount);
  const effectiveTargetCents = targetCents ? targetCents - spentInTargetCents : null;
  const remainingCents = effectiveTargetCents == null ? null : Math.max(0, effectiveTargetCents - totalCents);

  return {
    deadline,
    months: deadline ? monthsFromDeadline(deadline) : null,
    total: fromCents(totalCents),
    effectiveTarget: fromCents(effectiveTargetCents),
    remaining: fromCents(remainingCents),
    monthlySuggestion: monthlySuggestion(effectiveTargetCents, totalCents, deadline),
  };
}

// Une enveloppe et ses totaux, ou 404
export function getById(id) {
  const row = get(`${LIST_SQL} WHERE e.id = ?`, id);
  if (!row) throw httpError(404, "Enveloppe introuvable");
  return serialize(row);
}

// ─── Invariant : Σ enveloppes ouvertes d'un compte ≤ solde du compte ───

/**
 * Disponible « hors enveloppes » d'un compte sur le mois en cours (null si le solde est inconnu).
 *
 * C'est le chiffre qui autorise ou refuse une nouvelle mise de côté. Il vaut `null` —
 * et non zéro — tant que le solde du compte n'est pas connu : on ne bloque pas une
 * saisie sur une information qu'on n'a pas.
 *
 * Le mois de référence est le dernier **ouvert**, à défaut le dernier tout court : une
 * fois l'année clôturée, on continue de raisonner sur le dernier état connu.
 *
 * @param {number} accountId Le compte examiné.
 * @returns {{balance: number|null, envelopesTotal: number, available: number|null}} Et le contexte.
 */
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

// Le formulaire raisonne en mois (« months ») ; les services internes posent une date (« deadline »)
// Le `fallback` distingue « champ absent, on garde l'existant » de « champ vidé, on efface ».
function resolveDeadline(data, fallback = null) {
  if (data.months !== undefined) {
    return data.months === null || data.months === "" ? null : deadlineFromMonths(data.months);
  }
  if (data.deadline !== undefined) return data.deadline || null;
  return fallback;
}

/**
 * Crée une enveloppe, éventuellement déjà garnie.
 *
 * La mise de départ a deux provenances, et l'écart compte. **Prise dans une autre
 * enveloppe** du même compte, c'est une réaffectation : deux contributions liées, le
 * total du compte ne bouge pas. **Prise sur le disponible**, c'est une réservation
 * nouvelle, donc soumise à l'invariant — d'où le contrôle.
 *
 * @param {object} [data] `{ name, accountId, targetAmount, initialAmount, fromEnvelopeId, months|deadline }`.
 * @returns {object} L'enveloppe créée.
 */
export function create(data = {}) {
  const { accountId = null, targetAmount = null, initialAmount = null, fromEnvelopeId = null } = data;
  const deadline = resolveDeadline(data);
  let name = (data.name || "").trim();
  if (!name) throw httpError(400, "Le nom de l'enveloppe est requis");
  assertNameFree(name, accountId);
  if (accountId && !get("SELECT id FROM accounts WHERE id = ? AND is_active = 1", accountId)) {
    throw httpError(400, "Compte hôte invalide ou désactivé");
  }
  const cents = toCents(initialAmount);
  if (cents < 0) throw httpError(400, "Le montant initial doit être positif");

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

/**
 * Réaffectation entre deux enveloppes ouvertes d'un même compte.
 *
 * Une saisie, **deux contributions** : le retrait et le dépôt, chacun tracé avec le
 * nom de l'autre enveloppe. On ne déplace pas un solde, on écrit un mouvement — c'est
 * ce qui rend l'historique relisible six mois plus tard.
 *
 * Restreint à un même compte : d'un compte à l'autre, l'argent devrait physiquement
 * bouger, et c'est le rôle de `closeInto` ou d'un changement d'hôte.
 *
 * @param {number} fromId L'enveloppe qui donne.
 * @param {object} params `{ toEnvelopeId, amount, notes }`.
 * @returns {{from: object, to: object}} Les deux enveloppes après coup.
 */
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

/**
 * Modifie une enveloppe. Deux effets de bord y sont volontaires.
 *
 * **Changer de compte hôte** déplace de l'argent réel : un virement système part dans
 * le mois ouvert, sans quoi les deux soldes cesseraient de correspondre à la banque.
 * D'où le refus s'il n'y a aucun mois ouvert — mieux vaut bloquer que fausser.
 *
 * **Renommer** peut renommer le compte en retour, mais dans un seul cas : l'enveloppe
 * est seule sur ce compte et il portait exactement son nom. C'est la situation « un
 * compte = un projet », où voir les deux noms diverger n'aurait aucun sens.
 *
 * @param {number} id L'enveloppe.
 * @param {object} data Les champs à changer ; ceux absents gardent leur valeur.
 * @returns {object} L'enveloppe modifiée.
 */
export function update(id, data) {
  const existing = get("SELECT * FROM envelopes WHERE id = ?", id);
  if (!existing) throw httpError(404, "Enveloppe introuvable");

  return tx(() => {
    const name = data.name !== undefined ? String(data.name).trim() : existing.name;
    if (!name) throw httpError(400, "Le nom de l'enveloppe est requis");
    const accountId = data.accountId !== undefined ? data.accountId : existing.account_id;
    assertNameFree(name, accountId, id);
    // L'argent d'une enveloppe ne part jamais vers un compte désactivé (il sortirait du bilan)
    if (accountId && accountId !== existing.account_id && !get("SELECT id FROM accounts WHERE id = ? AND is_active = 1", accountId)) {
      throw httpError(400, "Compte hôte invalide ou désactivé");
    }
    const target = data.targetAmount !== undefined ? toCents(data.targetAmount) : existing.target_amount_cents;
    const deadline = resolveDeadline(data, existing.deadline);
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
      // Le compte suit le renommage 1:1, sauf si un autre compte porte déjà ce nom (unicité)
      if (account && siblings === 1 && account.name === existing.name
          && !get("SELECT id FROM accounts WHERE lower(name) = lower(?) AND id != ?", name, account.id)) {
        run("UPDATE accounts SET name = ? WHERE id = ?", name, account.id);
      }
    }
    return getById(id);
  });
}

/**
 * Supprime définitivement une enveloppe — uniquement si elle n'a jamais servi.
 *
 * Deux verrous, pour deux raisons différentes. Un **solde non nul** ferait disparaître
 * de l'argent réservé : la réponse porte alors un code que le front reconnaît, pour
 * proposer la clôture avec réaffectation plutôt qu'une impasse. Un **historique réel**
 * — versements ou dépenses — se conserve : la clôture existe pour ça.
 *
 * Les mouvements purement administratifs, eux, ne font pas une vie : une enveloppe
 * créée par erreur, remise à zéro, s'efface sans laisser de trou.
 *
 * @param {number} id L'enveloppe.
 * @returns {{message: string}}
 */
export function remove(id) {
  const existing = get("SELECT * FROM envelopes WHERE id = ?", id);
  if (!existing) throw httpError(404, "Enveloppe introuvable");

  const linked = get("SELECT label FROM budget_lines WHERE envelope_id = ? AND month_id IS NULL LIMIT 1", id);
  if (linked) {
    throw httpError(409, `Cette enveloppe alimente la ligne mensualisée « ${linked.label} » : démensualisez la ligne d'abord (template).`);
  }

  const contribs = all("SELECT kind, entry_id FROM envelope_contributions WHERE envelope_id = ?", id);
  const total = get("SELECT COALESCE(SUM(amount_cents), 0) AS s FROM envelope_contributions WHERE envelope_id = ?", id).s;
  // De la vraie vie = versements réels ou dépenses (liées ou non à une entrée de mois).
  // Les mouvements purement administratifs (initiale, ajustement, réaffectation) ne comptent pas :
  // une enveloppe soldée à 0 qui n'a jamais vécu peut disparaître (créée par erreur, test).
  const hasRealLife = contribs.some((c) => c.entry_id || c.kind === "normale" || c.kind === "depense");
  if (total !== 0) {
    const err = httpError(409, `« ${existing.name} » contient ${fromCents(total).toLocaleString("fr-FR", { minimumFractionDigits: 2 })} € : clôturez-la ou réaffectez son contenu (rien n'est perdu)`);
    err.payload = { code: "ENVELOPE_HAS_FUNDS", total: fromCents(total), contributions: contribs.length, accountId: existing.account_id };
    throw err;
  }
  if (hasRealLife) {
    throw httpError(409, `« ${existing.name} » a un historique réel (versements ou dépenses) : elle reste ${existing.closed_at ? "clôturée" : "— clôturez-la —"}, l'historique est conservé`);
  }

  run("DELETE FROM envelope_contributions WHERE envelope_id = ?", id);
  run("DELETE FROM envelopes WHERE id = ?", id);
  return { message: "Enveloppe supprimée" };
}

/**
 * Clôture une enveloppe en disant où va son contenu.
 *
 * C'est la sortie normale d'un projet terminé, et l'alternative à `remove` : rien
 * n'est effacé, une contribution négative trace le départ des fonds. La destination
 * est obligatoire dès qu'il reste de l'argent — sans elle, la somme s'évaporerait de
 * l'invariant sans que rien ne l'explique.
 *
 * Vers une **enveloppe** ouverte, ou vers le « hors enveloppes » d'un **compte** actif.
 * Si l'argent change de compte au passage, un virement système suit.
 *
 * @param {number} id L'enveloppe à clôturer.
 * @param {object} [dest] `{ toEnvelopeId }` ou `{ toAccountId }`.
 * @returns {object} L'enveloppe clôturée.
 */
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

// ─── Liquider et renouveler (enveloppes mensualisées) ─────────────────────────
// Le geste manuel qui ferme la boucle d'une charge lissée (Strava, N26…) : l'argent
// provisionné est viré vers le compte choisi (virement système tracé dans le mois,
// visible dans « Mouvements internes »), l'enveloppe repart à 0 et son échéance avance
// d'un cycle. AUCUNE dépense n'est créée : c'est l'utilisateur qui saisit ensuite sa
// ligne de paiement là où la banque l'a prélevé. Décision d'Evan du 05/09 — remplace
// le ☐ payé automatique pour son usage réel (provision sur un compte, paiement sur un autre).

/**
 * Vide une enveloppe mensualisée et fait repartir son cycle.
 *
 * @param {number} id L'enveloppe, forcément liée à une ligne du template.
 * @param {object} params `{ toAccountId }` — le compte où l'argent atterrit.
 * @returns {object} L'enveloppe remise à zéro, échéance avancée.
 */
export function liquidate(id, { toAccountId = null } = {}) {
  const existing = get("SELECT * FROM envelopes WHERE id = ?", id);
  if (!existing) throw httpError(404, "Enveloppe introuvable");
  if (existing.closed_at) throw httpError(409, "Enveloppe clôturée");
  const line = get("SELECT * FROM budget_lines WHERE envelope_id = ? AND month_id IS NULL LIMIT 1", id);
  if (!line) {
    throw httpError(409, "Cette enveloppe n'est pas liée à une ligne mensualisée : utilisez la clôture ou la réaffectation");
  }

  const total = get("SELECT COALESCE(SUM(amount_cents), 0) AS s FROM envelope_contributions WHERE envelope_id = ?", id).s;
  if (total <= 0) throw httpError(409, "L'enveloppe est vide : rien à liquider");

  const mainId = get("SELECT id FROM accounts WHERE is_main = 1 LIMIT 1")?.id ?? null;
  const host = existing.account_id ?? mainId;
  const account = get("SELECT * FROM accounts WHERE id = ? AND is_active = 1", toAccountId);
  if (!account) throw httpError(400, "Compte destinataire invalide");

  const month = get("SELECT * FROM months WHERE closed_at IS NULL ORDER BY period DESC LIMIT 1");
  if (!month) throw httpError(409, "Aucun mois ouvert pour enregistrer le virement de liquidation");

  return tx(() => {
    if (host && host !== account.id) {
      // Virement système LIÉ à l'enveloppe (envelope_id) : supprimer le virement dans le mois
      // annule proprement la liquidation — la contribution cascade, l'enveloppe retrouve son
      // argent (retour de test d'Evan : les deux étaient orphelins, l'annulation laissait un trou)
      const accName = (aid) => get("SELECT name FROM accounts WHERE id = ?", aid)?.name || "?";
      const { lastInsertRowid } = run(
        `INSERT INTO entries (month_id, label, amount_cents, account_id, to_account_id, source, envelope_id, envelope_in_target)
         VALUES (?, ?, ?, ?, ?, 'manuelle', ?, 0)`,
        month.id, `Liquidation « ${existing.name} » : ${accName(host)} → ${accName(account.id)} — le cycle repart`,
        total, host, account.id, id
      );
      syncEntryExpense(get("SELECT * FROM entries WHERE id = ?", Number(lastInsertRowid)));
    } else {
      // Même compte : pas de virement, l'argent est juste libéré hors enveloppes
      run("INSERT INTO envelope_contributions (envelope_id, amount_cents, kind, notes) VALUES (?, ?, 'reaffectation', ?)",
        id, -total, `Liquidation vers « ${account.name} » — le cycle repart`);
    }
    // Le cycle repart : l'échéance saute à l'occurrence qui SUIT celle qu'on vient de solder —
    // même liquidée en avance (échéance le mois prochain), on part de l'échéance, pas du virement
    const base = existing.deadline && existing.deadline.substring(0, 7) > month.period
      ? existing.deadline.substring(0, 7)
      : month.period;
    const nextPeriod = (() => { const [y, m] = base.split("-").map(Number); const i = y * 12 + m; return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`; })();
    run("UPDATE envelopes SET deadline = ? WHERE id = ?", nextDueDate(line, nextPeriod), id);
    return getById(id);
  });
}

// ─── Contributions ────────────────────────────────────────
// Chaque mouvement d'une enveloppe est une ligne, jamais une mise à jour de solde.
// Les genres : « initiale » (mise de départ), « normale » (versement), « depense »
// (payée depuis l'enveloppe, liée à une entrée du mois), « reaffectation » (entre
// enveloppes) et « ajustement » (recalage sur le solde réel).

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

// L'historique d'une enveloppe, du plus récent au plus ancien
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

/**
 * Aligne la contribution « depense » d'une entrée sur l'état de cette entrée.
 *
 * Appelé après chaque création ou modification d'entrée. Une seule fonction couvre les
 * trois cas — créer, mettre à jour, retirer — parce que le lien est **dérivé** de
 * l'entrée : si elle ne désigne plus d'enveloppe, la contribution n'a plus lieu
 * d'être. Traiter les trois séparément laisserait fatalement passer un cas.
 *
 * Le montant est inversé : une dépense retire de l'enveloppe.
 *
 * @param {object} entry La ligne `entries` telle qu'elle est en base.
 */
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

/**
 * Ajoute un mouvement à une enveloppe.
 *
 * Le plafond ne s'applique qu'à ce qui **réserve davantage** sur un compte déjà connu :
 * un versement sans source, ou depuis le compte hôte lui-même. Un transfert venu d'un
 * autre compte augmente le solde en même temps qu'il remplit l'enveloppe — le plafonner
 * bloquerait une opération pourtant équilibrée. Recalages et réaffectations sont les
 * voies prévues pour corriger, elles ne se plafonnent pas non plus.
 *
 * @param {number} envelopeId L'enveloppe.
 * @param {object} params `{ amount, date, kind, fromAccountId, notes }`.
 * @returns {object} L'enveloppe à jour.
 */
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

/**
 * Calcule l'écart entre le solde réel d'un compte et ce que ses enveloppes revendiquent.
 *
 * Rien n'est écrit : c'est ce qu'on montre avant de proposer le recalage. L'écart part
 * ensuite en contribution « ajustement » — jamais en correction silencieuse d'un
 * montant existant, qui effacerait la trace de la divergence.
 *
 * @param {number} envelopeId L'enveloppe qui portera l'ajustement.
 * @returns {{delta: number, accountBalance: number, envelopesTotal: number}} Et le contexte.
 */
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

// Pose l'écart calculé par recalibrationPreview en contribution « ajustement »
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

// ─── Dépendance circulaire avec summary ───────────────────
// summary.service lit les enveloppes pour bâtir ses soldes, et les enveloppes ont
// besoin de ces mêmes soldes pour vérifier leur invariant. Un import direct dans les
// deux sens laisserait l'un des deux modules à moitié chargé selon l'ordre de
// résolution ESM : le point d'entrée injecte donc summary après coup.
let _summary = null;
function summaryModule() {
  // Chargé à la demande : summary.service importe aussi ce module (dépendance circulaire)
  if (!_summary) throw httpError(500, "summary non initialisé");
  return _summary;
}
export function bindSummary(mod) { _summary = mod; }

// Retire un mouvement — sauf s'il est le reflet d'une entrée du mois, qui reste maître
export function removeContribution(envelopeId, contributionId) {
  const c = get("SELECT * FROM envelope_contributions WHERE id = ? AND envelope_id = ?", contributionId, envelopeId);
  if (!c) throw httpError(404, "Contribution introuvable");
  if (c.entry_id) throw httpError(409, "Cette dépense est liée à une entrée du mois : modifiez ou supprimez l'entrée");
  assertPeriodOpen(c.date);
  run("DELETE FROM envelope_contributions WHERE id = ?", contributionId);
  return getById(envelopeId);
}
