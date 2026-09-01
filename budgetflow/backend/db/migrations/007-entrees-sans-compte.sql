-- Correctif : des entrées ont pu être créées sans compte (formulaire « + ligne » d'une
-- catégorie revenu). Une entrée sans compte ne bouge aucun solde. On les rattache au
-- compte principal, comme le fait désormais le backend par défaut.

UPDATE entries
SET account_id = (SELECT id FROM accounts WHERE is_main = 1 LIMIT 1)
WHERE account_id IS NULL
  AND (SELECT id FROM accounts WHERE is_main = 1 LIMIT 1) IS NOT NULL;
