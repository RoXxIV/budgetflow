-- Module Partage (optionnel) : dépenses communes égalisées chaque mois avec un partenaire.
-- Règle : total commun = entrées marquées ½ + ce que le partenaire paie directement ;
-- ma part = total × mon % ; à envoyer = ma part − ce que j'ai payé en commun.

ALTER TABLE app_settings ADD COLUMN sharing_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE app_settings ADD COLUMN sharing_partner_name TEXT;
ALTER TABLE app_settings ADD COLUMN sharing_my_share REAL NOT NULL DEFAULT 50;      -- ma part en %
ALTER TABLE app_settings ADD COLUMN sharing_target_line_id INTEGER REFERENCES budget_lines(id) ON DELETE SET NULL; -- ligne du template où atterrit le virement
ALTER TABLE app_settings ADD COLUMN sharing_partner_payments TEXT NOT NULL DEFAULT '[]'; -- [{ "label": "Loyer", "amount": 630 }]
