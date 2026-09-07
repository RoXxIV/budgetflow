-- Fin du guide de première utilisation.
-- Le guide ne crée plus de mois à son terme : plus rien en base ne distinguerait alors
-- « guide terminé » de « guide jamais fait ». Un drapeau porte donc l'information, posé
-- explicitement par la dernière étape.

ALTER TABLE app_settings ADD COLUMN onboarding_done INTEGER NOT NULL DEFAULT 0;

-- Une base qui a déjà des comptes n'est pas une première utilisation : le guide ne doit
-- s'imposer ni à la base de dev, ni à l'application déjà installée.
UPDATE app_settings SET onboarding_done = 1 WHERE EXISTS (SELECT 1 FROM accounts);
