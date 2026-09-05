-- « Annuler ce mois-ci » : ce mois, je ne verse pas cette mensualité / ce DCA.
-- Le Reste à vivre cesse de le déduire, sans toucher au template ni à l'enveloppe —
-- le mois suivant, tout revient. Réversible (suppression de la ligne).

CREATE TABLE month_skips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  month_id INTEGER NOT NULL REFERENCES months(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('envelope', 'asset')),
  target_id INTEGER NOT NULL,
  UNIQUE (month_id, kind, target_id)
);
