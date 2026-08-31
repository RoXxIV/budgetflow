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

export function create({ name, type = "courant", isMain = false, includeInNetWorth = true, multiProjects = false, initialBalance = null }) {
  name = (name || "").trim();
  if (!name) throw httpError(400, "Le nom du compte est requis");

  return tx(() => {
    if (isMain) run("UPDATE accounts SET is_main = 0");
    // Premier compte créé → principal d'office (jamais demandé en mono-compte)
    const count = get("SELECT COUNT(*) AS n FROM accounts").n;
    const main = isMain || count === 0 ? 1 : 0;

    const { lastInsertRowid: id } = run(
      "INSERT INTO accounts (name, type, is_main, include_in_net_worth) VALUES (?, ?, ?, ?)",
      name, type, main, includeInNetWorth ? 1 : 0
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

    run("UPDATE accounts SET name = ?, type = ?, is_main = ?, include_in_net_worth = ? WHERE id = ?",
      name, type, isMain, inw, id);

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

export function remove(id) {
  const existing = get("SELECT * FROM accounts WHERE id = ?", id);
  if (!existing) throw httpError(404, "Compte introuvable");
  // Les enveloppes hébergées ne sont pas supprimées : account_id passe à NULL (ON DELETE SET NULL)
  run("DELETE FROM accounts WHERE id = ?", id);
  return { message: "Compte supprimé" };
}
