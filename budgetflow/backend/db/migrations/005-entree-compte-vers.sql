-- Une entrée de transfert (ou d'épargne) bouge l'argent d'un compte VERS un autre.
-- account_id = compte débité (ou crédité pour un revenu), to_account_id = compte destination.

ALTER TABLE entries ADD COLUMN to_account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL;
