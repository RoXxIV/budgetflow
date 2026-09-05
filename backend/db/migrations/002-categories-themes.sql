-- Catégories (blocs du sheet, typées) et thèmes (axe d'analyse transversal).
-- Le type de la catégorie pilote les calculs ; les noms appartiennent à l'utilisateur.

CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'depense'
    CHECK (type IN ('depense', 'revenu', 'epargne', 'transfert')),
  color TEXT NOT NULL DEFAULT '#6b7280',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE themes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6b7280',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
