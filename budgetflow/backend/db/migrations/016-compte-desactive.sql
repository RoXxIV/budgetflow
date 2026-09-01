-- Désactivation de compte : l'alternative propre à la suppression (l'historique reste).
-- Un compte désactivé disparaît des saisies, du bilan, du patrimoine et du pré-remplissage
-- des nouveaux mois ; il est réactivable à tout moment. La suppression définitive n'est
-- plus permise que pour un compte sans aucun historique (créé par erreur).

ALTER TABLE accounts ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
