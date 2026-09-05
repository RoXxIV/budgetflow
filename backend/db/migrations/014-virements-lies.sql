-- Virements « système » liés à une ligne : entrées SANS ligne ni catégorie (un mouvement entre deux
-- comptes n'a pas besoin de catégorie), rattachées à la ligne qui les a provoquées (☐ payé d'une ligne
-- mensualisée : enveloppe → compte prélevé ; reste pris sur un autre compte). Elles racontent ce que la
-- banque montre, ne comptent jamais comme dépense, et disparaissent avec la ligne ou au décochage.

ALTER TABLE entries ADD COLUMN related_line_id INTEGER REFERENCES budget_lines(id) ON DELETE CASCADE;
CREATE INDEX idx_entries_related_line ON entries(related_line_id);
