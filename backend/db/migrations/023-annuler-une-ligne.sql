-- « Annuler ce mois-ci » s'étend aux lignes du budget.
--
-- Le mécanisme existait depuis la 019, mais seulement pour les mensualités d'enveloppe
-- et les DCA. Une ligne de budget — un loyer, un abonnement — n'avait aucun moyen d'être
-- écartée pour un mois : le seul recours était de la SUPPRIMER du mois, ce qui efface la
-- trace du geste et se rejoue à la main si on change d'avis.
--
-- Annuler une ligne la sort du Reste à vivre et du projeté, sans toucher au template ni
-- aux entrées. Le mois suivant, elle revient. Réversible d'un clic.
--
-- POURQUOI UNE TABLE « _new » — SQLite ne sait pas modifier une contrainte CHECK. La
-- seule voie est de rebâtir : créer la table cible, y recopier les données, supprimer
-- l'ancienne, renommer. Le tout dans la transaction ouverte par applyMigrations : un
-- échec ne laisse rien à moitié fait. (Même motif que les migrations 009 et 012.)

CREATE TABLE month_skips_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  month_id INTEGER NOT NULL REFERENCES months(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('envelope', 'asset', 'line')),
  target_id INTEGER NOT NULL,
  UNIQUE (month_id, kind, target_id)
);

INSERT INTO month_skips_new (id, month_id, kind, target_id)
  SELECT id, month_id, kind, target_id FROM month_skips;

DROP TABLE month_skips;
ALTER TABLE month_skips_new RENAME TO month_skips;
