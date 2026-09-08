import { all, get, fromCents } from "../db/index.js";

// Moyennes mensuelles réelles, par thème et par catégorie — la matière du bouton
// « importer ma moyenne » du plan de financement.
//
// Deux précautions qui changent tout :
//  - le mois EN COURS est exclu : il est incomplet, il tirerait chaque moyenne vers
//    le bas d'autant plus fort que l'historique est court ;
//  - seules les dépenses comptent. Une moyenne globale de dépenses mélangerait les
//    versements d'enveloppes et les DCA aux vraies charges, et donnerait un « reste »
//    négatif qui ne veut rien dire.

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Ce que le Template pèse chaque mois, catégorie par catégorie.
 *
 * Sert au bouton « importer depuis le Template » : plutôt que de repartir d'une page
 * blanche, on reprend son budget type tel qu'il est. C'est la matière la plus fiable
 * du plan — le Template dit ce qui est PRÉVU, là où les moyennes disent ce qui a été
 * constaté.
 *
 * DEUX FAMILLES, et elles ne se mélangent pas. Les lignes ordinaires sont regroupées
 * par catégorie ; les lignes MENSUALISÉES — celles adossées à une enveloppe — sortent
 * du lot et gardent leur propre ligne. Les compter dans leur catégorie ET séparément
 * les ferait entrer deux fois dans le plan.
 *
 * LA PART MENSUELLE est arrondie au centime LIGNE PAR LIGNE, comme le fait l'écran
 * Template : une charge annuelle de 79,99 € pèse 6,67 €/mois, pas 6,6658…, et les deux
 * écrans doivent annoncer le même chiffre.
 *
 * Les enveloppes SANS ligne du Template ne sont pas ici : ce sont des projets
 * d'épargne, donc des objectifs, et ils relèvent de l'autre bloc du plan.
 *
 * @returns {{categories: Array<{id: number|null, name: string, type: string, lines: number, monthly: number}>,
 *   monthlyized: Array<{id: number, label: string, envelopeName: string, monthly: number,
 *   planned: number, intervalMonths: number}>}}
 */
export function templateBreakdown() {
  const lignes = all(
    `SELECT b.id, b.label, b.category_id, b.planned_amount_cents AS prevu,
            COALESCE(NULLIF(b.interval_months, 0), 1) AS cycle, b.envelope_id,
            c.name AS cat_name, c.type AS cat_type, c.sort_order AS cat_ordre,
            e.name AS env_name
     FROM budget_lines b
     LEFT JOIN categories c ON c.id = b.category_id
     LEFT JOIN envelopes e ON e.id = b.envelope_id
     WHERE b.month_id IS NULL`
  );

  const parMois = (l) => Math.round((l.prevu || 0) / l.cycle);

  const monthlyized = lignes
    .filter((l) => l.envelope_id)
    .map((l) => ({
      id: l.id,
      label: l.label,
      envelopeName: l.env_name,
      monthly: round2(fromCents(parMois(l))),
      planned: round2(fromCents(l.prevu)),
      intervalMonths: l.cycle,
    }))
    .filter((l) => l.monthly > 0)
    .sort((a, b) => b.monthly - a.monthly);

  const parCategorie = new Map();
  for (const l of lignes) {
    if (l.envelope_id) continue; // déjà sortie du lot, ne pas la compter deux fois
    const cle = l.category_id ?? 0;
    if (!parCategorie.has(cle)) {
      parCategorie.set(cle, {
        id: l.category_id ?? null,
        name: l.cat_name || "Sans catégorie",
        type: l.cat_type || "depense",
        ordre: l.cat_ordre ?? 999,
        lines: 0,
        cents: 0,
      });
    }
    const g = parCategorie.get(cle);
    g.lines += 1;
    g.cents += parMois(l);
  }

  const categories = [...parCategorie.values()]
    .map((g) => ({ id: g.id, name: g.name, type: g.type, lines: g.lines, monthly: round2(fromCents(g.cents)), ordre: g.ordre }))
    .filter((g) => g.monthly !== 0)
    .sort((a, b) => a.ordre - b.ordre)
    .map(({ ordre, ...g }) => g);

  return { categories, monthlyized };
}
const currentPeriod = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`; };

/**
 * Moyennes mensuelles par thème et par catégorie, sur les mois révolus.
 *
 * @returns {{months: number, from: string|null, to: string|null,
 *   themes: Array<{id: number, name: string, average: number}>,
 *   categories: Array<{id: number, name: string, type: string, average: number}>}}
 */
export function averages() {
  const now = currentPeriod();
  const months = all("SELECT id, period FROM months WHERE period < ? ORDER BY period", now);
  const n = months.length;
  if (!n) return { months: 0, from: null, to: null, themes: [], categories: [] };

  const ids = months.map((m) => m.id);
  const marks = ids.map(() => "?").join(",");

  // Le réel, entrée par entrée : c'est ce qui a été dépensé, pas ce qui était prévu
  const parTheme = all(
    `SELECT t.id, t.name, COALESCE(SUM(e.amount_cents), 0) AS c
     FROM themes t
     LEFT JOIN entries e ON e.theme_id = t.id AND e.month_id IN (${marks})
     GROUP BY t.id, t.name ORDER BY c DESC`, ...ids
  );

  const parCategorie = all(
    `SELECT c.id, c.name, c.type, COALESCE(SUM(e.amount_cents), 0) AS cents
     FROM categories c
     LEFT JOIN budget_lines b ON b.category_id = c.id AND b.month_id IN (${marks})
     LEFT JOIN entries e ON e.line_id = b.id
     GROUP BY c.id, c.name, c.type ORDER BY cents DESC`, ...ids
  );

  return {
    months: n,
    from: months[0].period,
    to: months[n - 1].period,
    themes: parTheme
      .map((t) => ({ id: t.id, name: t.name, average: round2(fromCents(t.c) / n) }))
      .filter((t) => t.average > 0),
    categories: parCategorie
      .map((c) => ({ id: c.id, name: c.name, type: c.type, average: round2(fromCents(c.cents) / n) }))
      .filter((c) => c.average > 0),
  };
}
