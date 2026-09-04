-- Tracker d'abonnements : page « bac à sable » persistante — rien ne se répercute
-- jamais sur le template, les mois ou les enveloppes. On y copie une fois les
-- abonnements du mois courant + les mensualisées, puis la liste vit sa vie
-- (ajouts, simulations d'offres moins chères, désactivation pour simuler une résiliation).

CREATE TABLE tracker_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  theme_id INTEGER REFERENCES themes(id) ON DELETE SET NULL,
  period TEXT NOT NULL DEFAULT 'mensuel' CHECK (period IN ('mensuel', 'annuel', 'hebdo')),
  price_cents INTEGER NOT NULL DEFAULT 0,
  sim_cents INTEGER,                -- montant de simulation (NULL = pas de simulation, 0 = résiliation simulée)
  day INTEGER,                      -- jour du mois (mensuel/annuel) ou jour de semaine 1-7 (hebdo)
  month INTEGER,                    -- mois de l'échéance (annuel seulement)
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
