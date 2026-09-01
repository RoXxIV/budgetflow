-- Cagnottes (révision du module Partage, 01/09/2026) : une cagnotte EST une ligne du budget
-- (template → présente chaque mois, ou ajoutée dans un mois), avec un partenaire, ce qu'il a
-- payé et ma part. Les entrées marquées ½ s'y rattachent ; le prévu de la ligne est CALCULÉ :
--   à envoyer = (Σ mes ½ + payé par le partenaire) × ma part − Σ mes ½
-- ☐ payé enregistre le virement. Les réglages globaux du module (008) disparaissent.

ALTER TABLE budget_lines ADD COLUMN is_pot INTEGER NOT NULL DEFAULT 0;
ALTER TABLE budget_lines ADD COLUMN pot_partner_name TEXT;
ALTER TABLE budget_lines ADD COLUMN pot_partner_paid_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE budget_lines ADD COLUMN pot_my_share REAL NOT NULL DEFAULT 50;
ALTER TABLE budget_lines ADD COLUMN pot_line_id INTEGER REFERENCES budget_lines(id) ON DELETE SET NULL; -- cagnotte par défaut des ½ de cette ligne

ALTER TABLE entries ADD COLUMN pot_line_id INTEGER REFERENCES budget_lines(id) ON DELETE SET NULL;      -- cagnotte concernée par ce ½

-- app_settings sans les colonnes du module 008 (reconstruction : une colonne FK ne se DROP pas)
CREATE TABLE app_settings_new (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  currency TEXT NOT NULL DEFAULT 'EUR',
  saving_rate REAL NOT NULL DEFAULT 0,
  payment_methods TEXT NOT NULL DEFAULT '["CB","virement","especes","autre"]'
);
INSERT INTO app_settings_new (id, currency, saving_rate, payment_methods)
  SELECT id, currency, saving_rate, payment_methods FROM app_settings;
DROP TABLE app_settings;
ALTER TABLE app_settings_new RENAME TO app_settings;
