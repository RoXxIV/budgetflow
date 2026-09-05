-- Casse des valeurs livrées par défaut (brief Paramètres §1.C / §7) : une base neuve
-- partait encore avec « virement », « especes », « autre » en minuscules et les types
-- d'investissement en capitales. Remplacements ciblés dans le JSON, idempotents —
-- les bases déjà corrigées par scripts/registre-parametres-donnees.mjs ne bougent pas.

UPDATE app_settings SET payment_methods = replace(replace(replace(payment_methods,
  '"virement"', '"Virement"'),
  '"especes"', '"Espèces"'),
  '"autre"', '"Autre"');

UPDATE app_settings SET investment_types = replace(replace(replace(investment_types,
  '"CRYPTO"', '"Crypto"'),
  '"STOCK"', '"Stock"'),
  '"OTHER"', '"Autre"');
