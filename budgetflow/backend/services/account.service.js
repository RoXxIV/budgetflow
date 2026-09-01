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
    createdAt: row.created_at,
    envelopes,
  };
}

export function list() {
  const accounts = all("SELECT * FROM accounts ORDER BY is_main DESC, name");
  const envelopes = envelopeService.list();
  return accounts.map((a) => serialize(a, envelopes.filter((e) => e.accountId === a.id)));
}

export function getById(id) {
  const row = get("SELECT * FROM accounts WHERE id = ?", id);
  if (!row) throw httpError(404, "Compte introuvable");
  return serialize(row, envelopeService.list().filter((e) => e.accountId === row.id));
}

export function create({ name, type = "courant", isMain = false, includeInNetWorth = true, allowOverdraft = false, multiProjects = false, initialBalance = null }) {
  name = (name || "").trim();
  if (!name) throw httpError(400, "Le nom du compte est requis");

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

export function update(id, data) {
  const existing = get("SELECT * FROM accounts WHERE id = ?", id);
  if (!existing) throw httpError(404, "Compte introuvable");

  return tx(() => {
    const name = data.name !== undefined ? String(data.name).trim() : existing.name;
    if (!name) throw httpError(400, "Le nom du compte est requis");

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

export function remove(id, { transferToAccountId = null } = {}) {
  const existing = get("SELECT * FROM accounts WHERE id = ?", id);
  if (!existing) throw httpError(404, "Compte introuvable");
  const others = get("SELECT COUNT(*) AS n FROM accounts WHERE id != ?", id).n;
  if (existing.is_main && others > 0) {
    throw httpError(409, "C'est le compte principal : désignez-en un autre avant de le supprimer");
  }

  // Solde connu et non nul → il faut dire où va l'argent (virement système, puis suppression)
  const balance = currentBalanceCents(id);
  if (balance !== null && balance !== 0 && others > 0) {
    if (!transferToAccountId) {
      const err = httpError(409, `« ${existing.name} » a un solde de ${(balance / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2 })} € : indiquez vers quel compte le virer avant suppression`);
      err.payload = { code: "ACCOUNT_HAS_BALANCE", balance: balance / 100 };
      throw err;
    }
    if (transferToAccountId === id || !get("SELECT id FROM accounts WHERE id = ?", transferToAccountId)) {
      throw httpError(400, "Compte destinataire invalide");
    }
    const month = get("SELECT * FROM months WHERE closed_at IS NULL ORDER BY period DESC LIMIT 1");
    if (!month) throw httpError(409, "Aucun mois ouvert pour enregistrer le virement du solde");
    const target = get("SELECT name FROM accounts WHERE id = ?", transferToAccountId).name;
    run(
      `INSERT INTO entries (month_id, label, amount_cents, account_id, to_account_id, source)
       VALUES (?, ?, ?, ?, ?, 'manuelle')`,
      month.id, `Solde de « ${existing.name} » viré vers « ${target} » avant suppression`,
      Math.abs(balance), balance > 0 ? id : transferToAccountId, balance > 0 ? transferToAccountId : id
    );
  }

  // Les enveloppes hébergées ne sont pas supprimées : account_id passe à NULL (ON DELETE SET NULL)
  run("DELETE FROM accounts WHERE id = ?", id);
  return { message: "Compte supprimé" };
}

// Solde live du compte sur le mois de référence (null si inconnu)
function currentBalanceCents(accountId) {
  const month = get("SELECT * FROM months WHERE closed_at IS NULL ORDER BY period DESC LIMIT 1")
    || get("SELECT * FROM months ORDER BY period DESC LIMIT 1");
  if (!month || !_summary) return null;
  const current = _summary.getSummary(month.id).accounts.find((a) => a.accountId === accountId)?.current ?? null;
  return current === null ? null : Math.round(current * 100);
}
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
