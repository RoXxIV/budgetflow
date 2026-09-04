-- Note libre par mois (bloc « Notes » de la colonne latérale de la page Mois).
-- Du texte de contexte, pas de l'argent : modifiable aussi sur un mois clôturé.

ALTER TABLE months ADD COLUMN notes TEXT;
