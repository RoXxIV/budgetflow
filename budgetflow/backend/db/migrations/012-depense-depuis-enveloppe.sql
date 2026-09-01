-- Dépense depuis une enveloppe, saisie dans le mois : une entrée peut être « depuis l'enveloppe X ».
-- Elle produit une contribution liée de type « depense » (montant négatif), synchronisée avec l'entrée.
-- « in_target » : la dépense fait partie du projet → la cible affichée est corrigée d'autant
-- (2 700 / 3 500 au lieu de 2 700 / 4 500), le reste à épargner ne bouge pas.

ALTER TABLE entries ADD COLUMN envelope_id INTEGER REFERENCES envelopes(id) ON DELETE SET NULL;
ALTER TABLE entries ADD COLUMN envelope_in_target INTEGER NOT NULL DEFAULT 1;

-- envelope_contributions : nouveau type « depense », lien vers l'entrée, drapeau in_target (reconstruction : CHECK)
CREATE TABLE envelope_contributions_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  envelope_id INTEGER NOT NULL REFERENCES envelopes(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL,
  date TEXT NOT NULL DEFAULT (date('now')),
  kind TEXT NOT NULL DEFAULT 'normale'
    CHECK (kind IN ('normale', 'initiale', 'ajustement', 'reaffectation', 'depense')),
  from_account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  entry_id INTEGER REFERENCES entries(id) ON DELETE CASCADE,   -- dépense liée à une entrée du mois
  in_target INTEGER NOT NULL DEFAULT 1,                          -- dépense comptée dans l'objectif
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO envelope_contributions_new (id, envelope_id, amount_cents, date, kind, from_account_id, notes, created_at)
  SELECT id, envelope_id, amount_cents, date, kind, from_account_id, notes, created_at FROM envelope_contributions;
DROP TABLE envelope_contributions;
ALTER TABLE envelope_contributions_new RENAME TO envelope_contributions;
CREATE INDEX idx_contributions_envelope ON envelope_contributions(envelope_id);
CREATE INDEX idx_contributions_entry ON envelope_contributions(entry_id);
