-- Visite guidée des onglets, jouée une fois le guide de configuration terminé.
-- Elle a son propre drapeau : le guide se clôt en rendant la main sur les Comptes,
-- la visite se clôt en arrivant sur les Mois — deux fins distinctes, deux marqueurs.

ALTER TABLE app_settings ADD COLUMN tour_done INTEGER NOT NULL DEFAULT 0;

-- Comme pour le guide : une base qui a déjà des comptes n'est pas une première
-- utilisation. Ni la base de dev ni l'application installée ne verront cette visite.
UPDATE app_settings SET tour_done = 1 WHERE EXISTS (SELECT 1 FROM accounts);
