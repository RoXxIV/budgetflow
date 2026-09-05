-- Découvert autorisé, par compte : sur un compte qui l'autorise, les contributions virtuelles et
-- montants initiaux d'enveloppes ne sont plus bloqués par l'invariant « Σ enveloppes ≤ solde » ;
-- le « hors enveloppes » peut être négatif (affiché en ambre, jamais caché).

ALTER TABLE accounts ADD COLUMN allow_overdraft INTEGER NOT NULL DEFAULT 0;
