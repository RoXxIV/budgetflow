-- Décision (01/09/2026) : plus de distinction fixe / variable, elle induisait en erreur.
-- Règle unique : une ligne a un prévu et un réel (somme des entrées) ; le réel remplace
-- le prévu dès qu'il existe. Une ligne avec un prévu et aucune entrée propose « ☐ payé ».
-- SQLite ≥ 3.35 : DROP COLUMN conserve les données et les clés étrangères (vérifié sur copie).

ALTER TABLE budget_lines DROP COLUMN kind;
