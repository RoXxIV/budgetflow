// Les comptes bancaires — et les trois règles qui les gouvernent.
//
// UN SEUL PRINCIPAL, TOUJOURS. Le compte principal définit le périmètre du « reste à
// vivre » et du « disponible » : sans lui, les tuiles du mois n'auraient plus de sujet.
// Le rôle se **transfère** (on le coche ailleurs), il ne se décoche jamais.
//
// JAMAIS DE PERTE. Un compte qui a servi ne se supprime pas, il se **désactive** :
// l'historique reste, il disparaît seulement du bilan et des listes. `remove` est
// réservé à celui créé par erreur, encore vierge.
//
// L'ARGENT NE S'ÉVAPORE PAS. Désactiver un compte qui a encore un solde exige de dire
// où va cet argent : un virement système part avant la désactivation, dans la même
// transaction.

import { all, get, run, tx, toCents, httpError } from "../db/index.js";
import * as envelopeService from "./envelope.service.js";

// Sérialisation API : camelCase, euros, booléens
function serialize(row, envelopes = []) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    isMain: !!row.is_main,
    includeInNetWorth: !!row.include_in_net_worth,
    allowOverdraft: !!row.allow_overdraft,
    isActive: !!row.is_active,
    createdAt: row.created_at,
    envelopes,
  };
}

// Tous les comptes, actifs d'abord, principal en tête, avec leurs enveloppes
export function list() {
  const accounts = all("SELECT * FROM accounts ORDER BY is_active DESC, is_main DESC, name");
  const envelopes = envelopeService.list();
  return accounts.map((a) => serialize(a, envelopes.filter((e) => e.accountId === a.id)));
}

export function getById(id) {
  const row = get("SELECT * FROM accounts WHERE id = ?", id);
  if (!row) throw httpError(404, "Compte introuvable");
  return serialize(row, envelopeService.list().filter((e) => e.accountId === row.id));
}

/**
 * Crée un compte.
 *
 * **`initialBalance` n'est utilisé QUE pour l'enveloppe** d'un compte épargne
 * mono-projet, et c'est délibéré : le solde d'un compte se saisit à la création d'un
 * mois, dans les snapshots. L'écrire ici en ferait une seconde source de vérité, qui
 * divergerait au premier écart avec la banque.
 *
 * Le compte épargne mono-projet reçoit une enveloppe du même nom d'office : c'est le
 * cas « un livret = un projet », où gérer l'enveloppe à la main serait une corvée sans
 * contrepartie. `multiProjects` désactive cet automatisme.
 *
 * @param {object} params Les champs du compte.
 * @returns {object} Le compte créé — principal d'office si c'est le premier.
 */
export function create({ name, type = "courant", isMain = false, includeInNetWorth = true, allowOverdraft = false, multiProjects = false, initialBalance = null }) {
  name = (name || "").trim();
  if (!name) throw httpError(400, "Le nom du compte est requis");
  if (get("SELECT id FROM accounts WHERE lower(name) = lower(?)", name)) {
    throw httpError(409, `Un compte « ${name} » existe déjà`);
  }

  return tx(() => {
    if (isMain) run("UPDATE accounts SET is_main = 0");
    // Premier compte créé → principal d'office (jamais demandé en mono-compte)
    const count = get("SELECT COUNT(*) AS n FROM accounts").n;
    const main = isMain || count === 0 ? 1 : 0;

    const { lastInsertRowid: id } = run(
      "INSERT INTO accounts (name, type, is_main, include_in_net_worth, allow_overdraft) VALUES (?, ?, ?, ?, ?)",
      name, type, main, includeInNetWorth ? 1 : 0, allowOverdraft ? 1 : 0
    );

    // Compte épargne mono-projet → enveloppe du même nom créée d'office,
    // avec le solde initial en première contribution
    if (type === "epargne" && !multiProjects) {
      const { lastInsertRowid: envId } = run(
        "INSERT INTO envelopes (name, account_id) VALUES (?, ?)", name, id
      );
      const cents = toCents(initialBalance);
      if (cents) {
        run(
          "INSERT INTO envelope_contributions (envelope_id, amount_cents, kind, notes) VALUES (?, ?, 'initiale', ?)",
          envId, cents, "Solde initial à la création du compte"
        );
      }
    }
    return getById(Number(id));
  });
}

/**
 * Modifie un compte.
 *
 * Le renommage peut renommer l'enveloppe en retour, dans le cas 1:1 seulement — une
 * seule enveloppe ouverte, qui portait le nom du compte. C'est le pendant exact de la
 * règle inverse dans envelope.service : ces deux objets ne font qu'un, les laisser
 * diverger n'apprendrait rien à personne.
 *
 * @param {number} id Le compte.
 * @param {object} data Les champs à changer.
 * @returns {object} Le compte modifié.
 */
export function update(id, data) {
  const existing = get("SELECT * FROM accounts WHERE id = ?", id);
  if (!existing) throw httpError(404, "Compte introuvable");

  return tx(() => {
    const name = data.name !== undefined ? String(data.name).trim() : existing.name;
    if (!name) throw httpError(400, "Le nom du compte est requis");
    if (get("SELECT id FROM accounts WHERE lower(name) = lower(?) AND id != ?", name, id)) {
      throw httpError(409, `Un compte « ${name} » existe déjà`);
    }

    // Toujours exactement un compte principal : le rôle se transfère (cocher ailleurs), il ne se décoche pas
    if (data.isMain === false && existing.is_main) {
      throw httpError(409, "Il faut toujours un compte principal : cochez « Compte principal » sur un autre compte pour lui transférer le rôle");
    }
    // …et il doit être ACTIF : un principal désactivé disparaîtrait du bilan (plus de disponible,
    // plus de périmètre) sans qu'aucun autre compte ne prenne le rôle (revue du 04/09)
    if (data.isMain === true && !existing.is_active) {
      throw httpError(409, "Un compte désactivé ne peut pas devenir le compte principal : réactivez-le d'abord");
    }
    if (data.isMain === true) run("UPDATE accounts SET is_main = 0");
    const isMain = data.isMain !== undefined ? (data.isMain ? 1 : 0) : existing.is_main;
    const type = data.type !== undefined ? data.type : existing.type;
    const inw = data.includeInNetWorth !== undefined ? (data.includeInNetWorth ? 1 : 0) : existing.include_in_net_worth;
    const overdraft = data.allowOverdraft !== undefined ? (data.allowOverdraft ? 1 : 0) : existing.allow_overdraft;

    run("UPDATE accounts SET name = ?, type = ?, is_main = ?, include_in_net_worth = ?, allow_overdraft = ? WHERE id = ?",
      name, type, isMain, inw, overdraft, id);

    // Renommage synchronisé quand 1:1 : une seule enveloppe ouverte, qui portait le nom du compte
    if (name !== existing.name) {
      const hosted = all("SELECT * FROM envelopes WHERE account_id = ? AND closed_at IS NULL", id);
      if (hosted.length === 1 && hosted[0].name === existing.name) {
        run("UPDATE envelopes SET name = ? WHERE id = ?", name, hosted[0].id);
      }
    }
    return getById(id);
  });
}

/**
 * Suppression définitive : réservée à un compte SANS historique (créé par erreur).
 *
 * Dès qu'un compte a des données, la voie propre est la désactivation (setActive) —
 * rien n'est perdu. Le décompte inclut volontairement les enveloppes **clôturées** :
 * une enveloppe close reste de l'histoire, et l'effacer avec son compte hôte ferait
 * disparaître des mouvements que les mois passés continuent de refléter.
 *
 * Le refus porte un code que le front reconnaît, pour proposer la désactivation.
 *
 * @param {number} id Le compte.
 * @returns {{message: string}}
 */
export function remove(id) {
  const existing = get("SELECT * FROM accounts WHERE id = ?", id);
  if (!existing) throw httpError(404, "Compte introuvable");
  const others = get("SELECT COUNT(*) AS n FROM accounts WHERE id != ?", id).n;
  if (existing.is_main && others > 0) {
    throw httpError(409, "C'est le compte principal : désignez-en un autre avant de le supprimer");
  }

  const u = usage(id);
  const snapshots = get("SELECT COUNT(*) AS n FROM account_snapshots WHERE account_id = ?", id).n;
  const history = u.entries + u.lines + u.assets + u.envelopes + snapshots
    + get("SELECT COUNT(*) AS n FROM envelopes WHERE account_id = ?", id).n - u.envelopes; // enveloppes clôturées incluses
  if (history > 0) {
    const err = httpError(409, `« ${existing.name} » a un historique (entrées, soldes, lignes ou enveloppes) : désactivez-le plutôt, rien ne sera perdu`);
    err.payload = { code: "ACCOUNT_HAS_HISTORY" };
    throw err;
  }

  run("DELETE FROM accounts WHERE id = ?", id);
  return { message: "Compte supprimé" };
}

// ─── Désactivation / réactivation (l'historique reste intact) ───

/**
 * Sort un compte du bilan, ou l'y ramène.
 *
 * Réactiver est immédiat : rien n'a été perdu, il n'y a rien à reconstruire.
 *
 * Désactiver traverse quatre refus, chacun protégeant une chose différente : le rôle
 * de principal, les enveloppes ouvertes qui perdraient leur hôte, les actifs dont les
 * versements deviendraient invisibles, et le solde restant — qui doit aller quelque
 * part. Le virement de solde et la désactivation sont dans la même transaction : un
 * échec au milieu laisserait de l'argent viré depuis un compte encore actif.
 *
 * @param {number} id Le compte.
 * @param {boolean} isActive L'état visé.
 * @param {object} [options]
 * @param {number|null} [options.transferToAccountId] Où virer le solde restant.
 * @returns {object} Le compte.
 */
export function setActive(id, isActive, { transferToAccountId = null } = {}) {
  const existing = get("SELECT * FROM accounts WHERE id = ?", id);
  if (!existing) throw httpError(404, "Compte introuvable");

  if (isActive) {
    run("UPDATE accounts SET is_active = 1 WHERE id = ?", id);
    return getById(id);
  }

  if (existing.is_main) {
    throw httpError(409, "C'est le compte principal : désignez-en un autre avant de le désactiver");
  }
  const openEnvelopes = get("SELECT COUNT(*) AS n FROM envelopes WHERE account_id = ? AND closed_at IS NULL", id).n;
  if (openEnvelopes > 0) {
    throw httpError(409, `« ${existing.name} » héberge ${openEnvelopes} enveloppe(s) ouverte(s) : clôturez-les ou déplacez-les d'abord`);
  }
  // Un actif ouvert sur un compte désactivé rendrait ses versements invisibles au bilan
  const openAssets = get("SELECT COUNT(*) AS n FROM assets WHERE account_id = ? AND closed_at IS NULL", id).n;
  if (openAssets > 0) {
    throw httpError(409, `« ${existing.name} » héberge ${openAssets} actif(s) ouvert(s) (investissements) : clôturez-les ou changez leur compte hôte d'abord`);
  }

  // Solde connu et non nul → il faut dire où va l'argent (virement système, puis désactivation).
  // Virement + désactivation sont atomiques : un échec ne doit pas laisser l'un sans l'autre.
  const balance = currentBalanceCents(id);
  return tx(() => {
    if (balance !== null && balance !== 0) {
      if (!transferToAccountId) {
        const err = httpError(409, `« ${existing.name} » a un solde de ${(balance / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2 })} € : indiquez vers quel compte le virer avant désactivation`);
        err.payload = { code: "ACCOUNT_HAS_BALANCE", balance: balance / 100 };
        throw err;
      }
      if (transferToAccountId === id || !get("SELECT id FROM accounts WHERE id = ? AND is_active = 1", transferToAccountId)) {
        throw httpError(400, "Compte destinataire invalide");
      }
      const month = get("SELECT * FROM months WHERE closed_at IS NULL ORDER BY period DESC LIMIT 1");
      if (!month) throw httpError(409, "Aucun mois ouvert pour enregistrer le virement du solde");
      const target = get("SELECT name FROM accounts WHERE id = ?", transferToAccountId).name;
      run(
        `INSERT INTO entries (month_id, label, amount_cents, account_id, to_account_id, source)
         VALUES (?, ?, ?, ?, ?, 'manuelle')`,
        month.id, `Solde de « ${existing.name} » viré vers « ${target} » avant désactivation`,
        Math.abs(balance), balance > 0 ? id : transferToAccountId, balance > 0 ? transferToAccountId : id
      );
    }

    run("UPDATE accounts SET is_active = 0 WHERE id = ?", id);
    return getById(id);
  });
}

// Solde live du compte sur le mois de référence (null si inconnu)
function currentBalanceCents(accountId) {
  const month = get("SELECT * FROM months WHERE closed_at IS NULL ORDER BY period DESC LIMIT 1")
    || get("SELECT * FROM months ORDER BY period DESC LIMIT 1");
  if (!month || !_summary) return null;
  const current = _summary.getSummary(month.id).accounts.find((a) => a.accountId === accountId)?.current ?? null;
  return current === null ? null : Math.round(current * 100);
}
// Injection de summary après chargement : les deux modules se lisent mutuellement
// (summary a besoin des comptes, les comptes ont besoin des soldes qu'il calcule).
let _summary = null;
export function bindSummary(mod) { _summary = mod; }

// Ce que la suppression d'un compte laisse derrière elle (pour la confirmation)
export function usage(id) {
  if (!get("SELECT id FROM accounts WHERE id = ?", id)) throw httpError(404, "Compte introuvable");
  return {
    envelopes: get("SELECT COUNT(*) AS n FROM envelopes WHERE account_id = ? AND closed_at IS NULL", id).n,
    entries: get("SELECT COUNT(*) AS n FROM entries WHERE account_id = ? OR to_account_id = ?", id, id).n,
    lines: get("SELECT COUNT(*) AS n FROM budget_lines WHERE from_account_id = ? OR to_account_id = ?", id, id).n,
    assets: get("SELECT COUNT(*) AS n FROM assets WHERE account_id = ?", id).n,
  };
}
