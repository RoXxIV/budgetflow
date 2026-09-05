-- Calculateurs (généralisation du compteur EDF) : objet défini par l'utilisateur.
--   paramètres  = constantes (prix HP, abonnement, TVA…)
--   relevés     = valeurs saisies chaque mois (index de compteur → conso = actuel − précédent, ou valeur directe)
--   formule     = expression arithmétique sur ces seuls symboles (périmètre fermé, évaluée sans eval)
--   ligne       = ligne du template rattachée (mensualité) → écart = estimé − prévu → régularisation
-- Aucun libellé métier en dur : « EDF », « hp », « hc » sont des choix de l'utilisateur.

CREATE TABLE calculators (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  formula TEXT NOT NULL DEFAULT '',
  line_id INTEGER REFERENCES budget_lines(id) ON DELETE SET NULL,   -- ligne du template (mensualité)
  theme_id INTEGER REFERENCES themes(id) ON DELETE SET NULL,        -- thème posé sur la régularisation
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE calculator_params (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  calculator_id INTEGER NOT NULL REFERENCES calculators(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  label TEXT,
  value REAL NOT NULL DEFAULT 0,
  unit TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (calculator_id, symbol)
);

CREATE TABLE calculator_reading_defs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  calculator_id INTEGER NOT NULL REFERENCES calculators(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  label TEXT,
  kind TEXT NOT NULL DEFAULT 'index' CHECK (kind IN ('index', 'valeur')),
  unit TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (calculator_id, symbol)
);

CREATE TABLE calculator_readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  def_id INTEGER NOT NULL REFERENCES calculator_reading_defs(id) ON DELETE CASCADE,
  month_id INTEGER NOT NULL REFERENCES months(id) ON DELETE CASCADE,
  previous_value REAL,   -- index de début (report du mois précédent), NULL pour un relevé « valeur »
  current_value REAL,    -- index de fin ou valeur saisie
  UNIQUE (def_id, month_id)
);
