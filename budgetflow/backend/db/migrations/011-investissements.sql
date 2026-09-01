-- Investissements : un actif (ETF, crypto…) hébergé sur un compte, des mouvements (versement / retrait)
-- et un historique de valorisation saisi à la main. Trois compteurs : investi, retiré, valeur.
--   performance = (valeur + retiré − investi) / investi   — un retrait ne fausse pas le %.
-- Un retrait est un transfert compte hôte → compte de contrepartie ; un versement l'inverse.

ALTER TABLE app_settings ADD COLUMN investment_types TEXT NOT NULL DEFAULT '["ETF","Crypto","Action","Autre"]';

CREATE TABLE assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT,                                                       -- liste configurable (app_settings.investment_types)
  account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,   -- compte hôte (PEA, Binance…)
  monthly_dca_cents INTEGER NOT NULL DEFAULT 0,                    -- versement mensuel prévu (☐ versé dans le mois)
  closed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE asset_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('versement', 'retrait')),
  amount_cents INTEGER NOT NULL,
  date TEXT NOT NULL DEFAULT (date('now')),
  counterpart_account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL, -- source du versement / destination du retrait
  source TEXT NOT NULL DEFAULT 'manuelle' CHECK (source IN ('manuelle', 'dca')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_asset_movements_asset ON asset_movements(asset_id);
CREATE INDEX idx_asset_movements_date ON asset_movements(date);

CREATE TABLE asset_valuations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  date TEXT NOT NULL DEFAULT (date('now')),
  value_cents INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_asset_valuations_asset ON asset_valuations(asset_id);
