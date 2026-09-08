// Les mois : l'unité de temps de toute l'application.
//
// Un mois n'est pas une vue sur les données, c'est un **objet gelé**. À sa naissance,
// il recopie le budget type ligne par ligne ; à partir de là il vit sa vie propre.
// Modifier le template ensuite ne rétroagit sur aucun mois déjà créé — c'est ce qui
// permet de relire janvier tel qu'il a été vécu, et non tel qu'on budgète aujourd'hui.
//
// Deux états : ouvert, où l'on saisit ; **clôturé**, où plus rien ne bouge. La clôture
// n'est pas un archivage décoratif, elle verrouille : les entrées, les contributions
// d'enveloppe datées dedans, et la suppression du mois lui-même.
//
// Les soldes de comptes sont **saisis**, pas déduits. Chaque mois porte ses snapshots
// de début de période, et c'est sur eux que se rebâtissent tous les soldes courants.

import { all, get, run, tx, toCents, fromCents, httpError } from "../db/index.js";
import * as budgetLines from "./budgetLine.service.js";
import * as pots from "./pot.service.js";

const MONTH_NAMES = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];

// « 2026-09 » → « Septembre 2026 » : les messages d'erreur nomment le mois, pas sa période
export function monthName(period) {
  const [y, m] = period.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}
const formatPeriodName = monthName;

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function serialize(row) {
  return {
    id: row.id,
    period: row.period,
    name: monthName(row.period),
    isClosed: !!row.closed_at,
    notes: row.notes || "",
    createdAt: row.created_at,
  };
}

// ─── « Annuler ce mois-ci » : cette dépense n'aura pas lieu ce mois ───
// Trois cibles possibles : une mensualité d'enveloppe, un DCA, ou une LIGNE du budget.
// Le Reste à vivre cesse de la déduire ; rien d'autre ne bouge, tout revient le mois
// suivant. C'est une exception ponctuelle, pas une modification : le mois suivant repart
// de la règle habituelle sans qu'on ait rien à réactiver.
//
// L'alternative — supprimer la ligne du mois — efface la trace du geste et se rejoue à la
// main si on change d'avis. Annuler garde la ligne, la met de côté, et se défait d'un clic.

const SKIP_KINDS = ["envelope", "asset", "line"];

// Les exceptions posées sur ce mois
export function listSkips(monthId) {
  getById(monthId);
  return all("SELECT kind, target_id AS targetId FROM month_skips WHERE month_id = ?", monthId);
}

/**
 * Écarte une cible du Reste à vivre, pour ce mois seulement.
 *
 * Une ligne est vérifiée comme appartenant à CE mois : sans ce contrôle, on pourrait
 * annuler la ligne d'un autre mois — ou une ligne du template — en passant son
 * identifiant, et le chiffre affiché deviendrait faux sans rien pour l'expliquer.
 *
 * INSERT OR IGNORE : reposer deux fois la même exception ne doit pas échouer.
 *
 * @param {number} monthId Le mois, qui doit être ouvert.
 * @param {object} params `{ kind: 'envelope'|'asset'|'line', targetId }`.
 * @returns {Array<object>} Toutes les exceptions du mois.
 */
export function addSkip(monthId, { kind, targetId }) {
  assertOpen(monthId);
  if (!SKIP_KINDS.includes(kind) || !Number(targetId)) throw httpError(400, "Cible invalide");
  if (kind === "line" && !get("SELECT id FROM budget_lines WHERE id = ? AND month_id = ?", Number(targetId), monthId)) {
    throw httpError(404, "Cette ligne n'appartient pas à ce mois");
  }
  run("INSERT OR IGNORE INTO month_skips (month_id, kind, target_id) VALUES (?, ?, ?)", monthId, kind, Number(targetId));
  return listSkips(monthId);
}

// Retire l'exception : la cible redevient déduite du reste à vivre
export function removeSkip(monthId, kind, targetId) {
  assertOpen(monthId);
  run("DELETE FROM month_skips WHERE month_id = ? AND kind = ? AND target_id = ?", monthId, kind, Number(targetId));
  return listSkips(monthId);
}

// Note libre du mois — du contexte, pas de l'argent : autorisée aussi sur un mois clôturé
export function setNotes(id, notes) {
  const row = get("SELECT * FROM months WHERE id = ?", id);
  if (!row) throw httpError(404, "Mois introuvable");
  run("UPDATE months SET notes = ? WHERE id = ?", String(notes ?? "").trim() || null, id);
  return getById(id);
}

// Tous les mois, du plus récent au plus ancien
export function list() {
  return all("SELECT * FROM months ORDER BY period DESC").map(serialize);
}

export function getById(id) {
  const row = get("SELECT * FROM months WHERE id = ?", id);
  if (!row) throw httpError(404, "Mois introuvable");
  return serialize(row);
}

// « Mois en cours » : le mois ouvert du calendrier, sinon le mois ouvert le plus récent, sinon null
// Le repli compte : le 1er octobre, avant d'avoir créé octobre, on veut atterrir sur
// septembre plutôt que sur un écran vide.
export function current() {
  const now = new Date();
  const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const row = get("SELECT * FROM months WHERE period = ? AND closed_at IS NULL", period)
    || get("SELECT * FROM months WHERE closed_at IS NULL ORDER BY period DESC LIMIT 1");
  return row ? serialize(row) : null;
}

// Le garde-fou de la clôture : toute écriture dans un mois passe par ici
export function assertOpen(monthId) {
  const row = get("SELECT * FROM months WHERE id = ?", monthId);
  if (!row) throw httpError(404, "Mois introuvable");
  if (row.closed_at) throw httpError(409, `${monthName(row.period)} est clôturé`);
  return row;
}

/**
 * Les lignes du mois, chacune avec son réel.
 *
 * Le **prévu** vient de la ligne, le **réel** est la somme de ses entrées : jamais
 * stocké, donc jamais désynchronisé. Une cagnotte fait exception sur le prévu — sa
 * part à envoyer se recalcule à partir de ce que le partenaire a déjà payé, c'est un
 * résultat, pas une saisie.
 *
 * @param {number} monthId Le mois.
 * @returns {Array<object>} Les lignes, dans leur ordre d'affichage.
 */
export function getLines(monthId) {
  // Les lignes écartées ce mois-ci : l'écran les relègue dans sa section « annulées »
  const annulees = new Set(
    all("SELECT target_id FROM month_skips WHERE month_id = ? AND kind = 'line'", monthId).map((s) => s.target_id)
  );
  const rows = all(
    `SELECT bl.*, COALESCE((SELECT SUM(e.amount_cents) FROM entries e WHERE e.line_id = bl.id), 0) AS actual_cents,
       (SELECT COUNT(*) FROM entries e WHERE e.line_id = bl.id) AS entry_count
     FROM budget_lines bl WHERE bl.month_id = ? ORDER BY bl.sort_order, bl.id`,
    monthId
  );
  // Cagnottes : le prévu affiché est le « à envoyer » calculé
  const potById = Object.fromEntries(pots.computeAll(monthId).map((p) => [p.id, p]));
  return rows.map((r) => {
    const line = {
      ...budgetLines.serialize(r),
      actualAmount: fromCents(r.actual_cents),
      entryCount: r.entry_count,
    };
    if (r.is_pot && potById[r.id]) {
      const { toSendCents, ...pot } = potById[r.id];
      line.pot = pot;
      line.plannedAmount = pot.toSend;
    }
    line.isSkipped = annulees.has(r.id);
    return line;
  });
}

// ─── Snapshots ────────────────────────────────────────────
// Le solde de chaque compte au DÉBUT du mois, saisi par l'utilisateur d'après sa
// banque. C'est le seul point d'ancrage réel de l'application : tout solde affiché
// ailleurs est ce chiffre plus les mouvements enregistrés depuis.

export function getSnapshots(monthId) {
  return all("SELECT * FROM account_snapshots WHERE month_id = ?", monthId).map((s) => ({
    id: s.id,
    accountId: s.account_id,
    balance: fromCents(s.balance_cents),
  }));
}

/**
 * Enregistre ou corrige des soldes de début de mois.
 *
 * Un solde absent, vide ou `null` est **ignoré**, pas effacé : l'écran n'envoie pas
 * toujours tous les comptes, et un champ laissé vide veut dire « je ne sais pas
 * encore », jamais « remets à zéro ». Sans cette précaution, ouvrir le formulaire et
 * l'enregistrer sans rien saisir détruirait des soldes déjà connus.
 *
 * @param {number} monthId Le mois, qui doit être ouvert.
 * @param {Array<{accountId: number, balance: number}>} snapshots Les soldes à poser.
 * @returns {Array<object>} Tous les snapshots du mois après coup.
 */
export function upsertSnapshots(monthId, snapshots) {
  assertOpen(monthId);
  tx(() => {
    for (const s of snapshots) {
      if (s.balance === null || s.balance === undefined || s.balance === "") continue;
      run(
        `INSERT INTO account_snapshots (month_id, account_id, balance_cents) VALUES (?, ?, ?)
         ON CONFLICT (month_id, account_id) DO UPDATE SET balance_cents = excluded.balance_cents`,
        monthId, s.accountId, toCents(s.balance)
      );
    }
  });
  return getSnapshots(monthId);
}

// ─── Pré-remplissage du formulaire de création ────────────
// Période proposée = mois suivant le dernier mois existant, sinon mois courant.
// Soldes proposés = solde LIVE de fin du dernier mois (début + mouvements) : une suggestion
// que l'utilisateur corrige (arrondis bancaires, intérêts…) — chaque mois repart de sa saisie.

/**
 * Prépare le formulaire de création du mois suivant.
 *
 * Rien n'est écrit : ce sont des **propositions**. Le solde de fin calculé pour le
 * mois précédent est presque toujours juste à quelques centimes près — intérêts,
 * arrondis, une opération oubliée — et c'est justement le moment où l'utilisateur
 * confronte l'application à sa banque. Reporter ces chiffres automatiquement ferait
 * dériver l'ancrage réel de mois en mois.
 *
 * @returns {Promise<{period: string, snapshots: Array, envelopes: Array}>} De quoi remplir le formulaire.
 */
export async function prefill() {
  const latest = get("SELECT * FROM months ORDER BY period DESC LIMIT 1");
  let period;
  if (latest) {
    const [y, m] = latest.period.split("-").map(Number);
    period = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  } else {
    const now = new Date();
    period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }
  let snapshots = [];
  if (latest) {
    const { getSummary } = await import("./summary.service.js"); // import différé (dépendance circulaire)
    snapshots = getSummary(latest.id).accounts
      .filter((a) => a.current !== null)
      .map((a) => ({ accountId: a.accountId, balance: a.current }));
  }
  // Enveloppes ouvertes : cumul actuel, à recaler en même temps que les comptes
  const { list: listEnvelopes } = await import("./envelope.service.js");
  const envelopes = listEnvelopes()
    .filter((e) => !e.isClosed)
    .map((e) => ({ id: e.id, name: e.name, accountId: e.accountId, accountName: e.accountName, total: e.total }));
  return { period, previousPeriod: latest?.period ?? null, snapshots, envelopes };
}

// ─── Création : duplication du template ───────────────────

/**
 * Crée un mois en y recopiant le budget type.
 *
 * C'est l'opération la plus structurante de l'application, et elle est **irréversible
 * dans son principe** : les lignes copiées appartiennent désormais au mois, elles ne
 * suivront plus le template.
 *
 * Trois choses s'y jouent, dans cet ordre :
 *
 *  1. **La copie du template**, filtrée par la périodicité — une charge trimestrielle
 *     n'entre que les mois où son cycle tombe. Les rattachements « ½ » sont recâblés
 *     dans un second passage : ils doivent pointer vers la copie de la cagnotte **dans
 *     ce mois**, pas vers celle du template, sans quoi le calcul du mois irait lire un
 *     montant qui ne le concerne pas.
 *  2. **Les soldes de début**, tels que l'utilisateur les a corrigés.
 *  3. **Le recalage des enveloppes** : l'écart entre le cumul enregistré et le montant
 *     réel devient une contribution « ajustement », jamais une réécriture — la
 *     divergence reste lisible dans l'historique.
 *
 * Le refus sans compte actif n'est pas une formalité : un mois suit des soldes, il n'a
 * rien à suivre sans compte, et c'est ce refus qui impose l'ordre du guide de bienvenue.
 *
 * @param {object} params `{ period, snapshots, envelopes }`.
 * @returns {object} Le mois créé.
 */
export function create({ period, snapshots = [], envelopes = [] }) {
  if (!PERIOD_RE.test(period || "")) throw httpError(400, "Période invalide (attendu : YYYY-MM)");
  const existing = get("SELECT id FROM months WHERE period = ?", period);
  if (existing) throw httpError(409, `Un mois existe déjà pour ${monthName(period)}`);
  // Un mois sans compte n'a pas de sens : pas de solde à suivre, pas de bilan (retour de test à vide)
  if (!get("SELECT id FROM accounts WHERE is_active = 1 LIMIT 1")) {
    throw httpError(409, "Créez d'abord un compte (page Comptes) : un mois suit des soldes, il lui faut au moins un compte actif.");
  }

  return tx(() => {
    const { lastInsertRowid: monthId } = run("INSERT INTO months (period) VALUES (?)", period);

    // Duplication des lignes du template (ordre conservé, origine tracée)
    // Seules les lignes dont le cycle tombe sur ce mois sont copiées (mensuelles : toujours)
    const templateLines = all("SELECT * FROM budget_lines WHERE month_id IS NULL ORDER BY sort_order, id")
      .filter((line) => budgetLines.cycleMatches(line, period));
    const newIdByTemplateId = {};
    for (const line of templateLines) {
      const { lastInsertRowid } = run(
        `INSERT INTO budget_lines
          (month_id, template_line_id, label, category_id, theme_id, planned_amount_cents,
           from_account_id, to_account_id, payment_method, is_shared, recurring_day, sort_order, notes,
           is_pot, pot_partner_name, pot_partner_paid_cents, pot_my_share,
           interval_months, anchor_month, envelope_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        monthId, line.id, line.label, line.category_id, line.theme_id,
        line.planned_amount_cents, line.from_account_id, line.to_account_id,
        line.payment_method, line.is_shared, line.recurring_day, line.sort_order, line.notes,
        line.is_pot, line.pot_partner_name, line.pot_partner_paid_cents, line.pot_my_share,
        line.interval_months || 1, line.anchor_month, line.envelope_id
      );
      newIdByTemplateId[line.id] = Number(lastInsertRowid);
    }
    // Rattachement ½ → cagnotte : on pointe vers la COPIE de la cagnotte dans ce mois
    for (const line of templateLines) {
      if (line.pot_line_id && newIdByTemplateId[line.pot_line_id]) {
        run("UPDATE budget_lines SET pot_line_id = ? WHERE id = ?", newIdByTemplateId[line.pot_line_id], newIdByTemplateId[line.id]);
      }
    }

    for (const s of snapshots) {
      if (s.balance === null || s.balance === undefined || s.balance === "") continue;
      run(
        "INSERT INTO account_snapshots (month_id, account_id, balance_cents) VALUES (?, ?, ?)",
        monthId, s.accountId, toCents(s.balance)
      );
    }

    // Recalage des enveloppes : l'écart entre le cumul et le montant réel saisi devient
    // une contribution « ajustement » datée du 1er du mois (historique conservé)
    for (const e of envelopes) {
      if (e.total === null || e.total === undefined || e.total === "") continue;
      const env = get("SELECT * FROM envelopes WHERE id = ? AND closed_at IS NULL", e.envelopeId);
      if (!env) continue;
      const current = get("SELECT COALESCE(SUM(amount_cents), 0) AS s FROM envelope_contributions WHERE envelope_id = ?", env.id).s;
      const delta = toCents(e.total) - current;
      if (delta === 0) continue;
      run(
        "INSERT INTO envelope_contributions (envelope_id, amount_cents, date, kind, notes) VALUES (?, ?, ?, 'ajustement', ?)",
        env.id, delta, `${period}-01`, e.notes || `Recalage à la création de ${formatPeriodName(period)}`
      );
    }

    return getById(Number(monthId));
  });
}

// Clôture ou réouverture. Rouvrir n'efface rien : le verrou saute, c'est tout.
export function setClosed(id, isClosed) {
  const row = get("SELECT * FROM months WHERE id = ?", id);
  if (!row) throw httpError(404, "Mois introuvable");
  run("UPDATE months SET closed_at = ? WHERE id = ?", isClosed ? new Date().toISOString() : null, id);
  return getById(id);
}

/**
 * Supprime un mois et tout ce qu'il contenait.
 *
 * La cascade emporte ses lignes, ses entrées et ses snapshots — c'est voulu : une
 * ligne de mois orpheline n'a aucun sens, et les soldes des mois suivants repartent
 * de leurs propres snapshots. Le passage obligé par la réouverture n'est pas
 * décoratif : un mois clôturé est fermé jusqu'à la dernière entrée, sa suppression
 * demande donc le même geste délibéré que sa modification.
 *
 * @param {number} id Le mois, qui doit être ouvert.
 * @returns {{message: string}}
 */
export function remove(id) {
  const row = get("SELECT * FROM months WHERE id = ?", id);
  if (!row) throw httpError(404, "Mois introuvable");
  // Un mois clôturé est verrouillé jusqu'à la dernière entrée : sa suppression aussi (rouvrir d'abord)
  if (row.closed_at) throw httpError(409, `${monthName(row.period)} est clôturé : rouvrez-le avant de le supprimer`);
  run("DELETE FROM months WHERE id = ?", id); // lignes, entrées et snapshots suivent (CASCADE)
  return { message: `${monthName(row.period)} supprimé` };
}
