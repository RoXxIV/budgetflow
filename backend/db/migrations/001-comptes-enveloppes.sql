-- Socle : comptes, enveloppes, contributions, paramètres.
-- Montants stockés en centimes (INTEGER) pour éviter les erreurs de flottants.

CREATE TABLE accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'courant'
    CHECK (type IN ('courant', 'epargne', 'investissement', 'especes')),
  is_main INTEGER NOT NULL DEFAULT 0,            -- compte principal (un seul)
  include_in_net_worth INTEGER NOT NULL DEFAULT 1, -- inclus dans le patrimoine
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE envelopes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL, -- compte hôte (optionnel)
  target_amount_cents INTEGER,                   -- cible (optionnelle)
  deadline TEXT,                                 -- échéance (optionnelle, date ISO)
  closed_at TEXT,                                -- clôture (historique conservé)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE envelope_contributions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  envelope_id INTEGER NOT NULL REFERENCES envelopes(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL,                 -- négatif autorisé (retrait, réaffectation)
  date TEXT NOT NULL DEFAULT (date('now')),
  kind TEXT NOT NULL DEFAULT 'normale'
    CHECK (kind IN ('normale', 'initiale', 'ajustement', 'reaffectation')),
  from_account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL, -- compte source (transfert réel si != compte hôte)
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_contributions_envelope ON envelope_contributions(envelope_id);

-- Singleton (id = 1 imposé)
CREATE TABLE app_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  currency TEXT NOT NULL DEFAULT 'EUR',
  saving_rate REAL NOT NULL DEFAULT 0,           -- objectif d'épargne en % du revenu du mois
  payment_methods TEXT NOT NULL DEFAULT '["CB","virement","especes","autre"]'
);
INSERT INTO app_settings (id) VALUES (1);
