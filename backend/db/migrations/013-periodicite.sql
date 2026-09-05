-- Périodicité d'une ligne du template : « tous les N mois », ancrée sur un mois.
--   interval_months = 1 → mensuelle (défaut) ; 12 + anchor_month 7 → chaque juillet ; 6 + 3 → mars et septembre.
-- La ligne n'est copiée dans un mois que si le mois tombe sur le cycle.
-- Mensualisation : une ligne non mensuelle peut être liée à une ENVELOPPE (cible = prévu, échéance = prochaine
-- occurrence) ; la mensualité suggérée de l'enveloppe lisse la charge, et le ☐ payé de la ligne sort de l'enveloppe.

ALTER TABLE budget_lines ADD COLUMN interval_months INTEGER NOT NULL DEFAULT 1;
ALTER TABLE budget_lines ADD COLUMN anchor_month INTEGER CHECK (anchor_month BETWEEN 1 AND 12);
ALTER TABLE budget_lines ADD COLUMN envelope_id INTEGER REFERENCES envelopes(id) ON DELETE SET NULL;
