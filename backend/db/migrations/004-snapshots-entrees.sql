-- Snapshots de début de mois (recalage mensuel par compte) et entrées réelles.
-- Le réel d'une ligne = SOMME de ses entrées, calculé à la lecture (jamais de compteur caché).

CREATE TABLE account_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  month_id INTEGER NOT NULL REFERENCES months(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  balance_cents INTEGER NOT NULL,
  UNIQUE (month_id, account_id)
);

CREATE TABLE entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  month_id INTEGER NOT NULL REFERENCES months(id) ON DELETE CASCADE,
  line_id INTEGER REFERENCES budget_lines(id) ON DELETE CASCADE,
  label TEXT,                                    -- détail affiché (« Amazon — écouteurs »)
  amount_cents INTEGER NOT NULL,
  date TEXT NOT NULL DEFAULT (date('now')),
  account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  payment_method TEXT,
  theme_id INTEGER REFERENCES themes(id) ON DELETE SET NULL, -- surcharge le thème de la ligne
  is_shared INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'manuelle'
    CHECK (source IN ('manuelle', 'paye', 'regularisation')), -- paye = créée par « ☐ payé »
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_entries_month ON entries(month_id);
CREATE INDEX idx_entries_line ON entries(line_id);
