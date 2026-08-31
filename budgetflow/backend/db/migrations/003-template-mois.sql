-- Mois et lignes budgétaires.
-- Une ligne avec month_id NULL est une ligne du TEMPLATE (pas de faux mois « template »).
-- À la création d'un mois, les lignes du template sont dupliquées avec template_line_id
-- pour tracer l'origine (propagation, « reporter dans le template »).

CREATE TABLE months (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  period TEXT NOT NULL UNIQUE,                   -- 'YYYY-MM', un seul mois calendaire
  closed_at TEXT,                                -- NULL = ouvert, sinon clôturé (saisies verrouillées)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE budget_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  month_id INTEGER REFERENCES months(id) ON DELETE CASCADE,  -- NULL = ligne du template
  template_line_id INTEGER REFERENCES budget_lines(id) ON DELETE SET NULL,
  label TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  theme_id INTEGER REFERENCES themes(id) ON DELETE SET NULL, -- thème par défaut, surchargeable par entrée
  kind TEXT NOT NULL DEFAULT 'variable'
    CHECK (kind IN ('fixe', 'variable')),        -- fixe = présumé payé au prévu, ☐ payé ; variable = plafond
  planned_amount_cents INTEGER NOT NULL DEFAULT 0,
  from_account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL, -- compte débité par défaut
  to_account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,   -- compte crédité (revenus, virements)
  payment_method TEXT,
  is_shared INTEGER NOT NULL DEFAULT 0,          -- partagé par défaut (module partage)
  recurring_day INTEGER CHECK (recurring_day BETWEEN 1 AND 31), -- jour du prélèvement (fixes)
  sort_order INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_budget_lines_month ON budget_lines(month_id);
CREATE INDEX idx_budget_lines_template ON budget_lines(template_line_id);
