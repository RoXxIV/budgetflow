// Les calculateurs : estimer une facture à partir de relevés, mois après mois.
//
// LE PROBLÈME — l'électricité se paie en mensualités lissées, et la vraie facture
// tombe une fois par an. Entre-temps, on ne sait pas si on dérive. Un calculateur
// répond à ça : on saisit ses index de compteur, une formule les convertit en euros,
// et l'écart avec la mensualité prévue devient visible dès le premier mois.
//
// TROIS PIÈCES. Les PARAMÈTRES sont les constantes du contrat (prix du kWh, TVA,
// abonnement) ; les RELEVÉS sont ce qu'on saisit chaque mois ; la FORMULE les combine.
//
// DEUX SORTES DE RELEVÉS, et l'écart compte. Un « index » se lit sur un compteur qui
// ne redescend jamais : la consommation est la DIFFÉRENCE avec le relevé précédent.
// Une « valeur » se saisit directement. C'est ce qui permet de reporter automatiquement
// l'index de fin d'un mois en index de début du suivant.

import { all, get, run, tx, toCents, fromCents, httpError } from "../db/index.js";
import { evaluate, isValidSymbol, symbolsOf } from "../lib/formula.js";
import { assertOpen } from "./month.service.js";

// ─── Définition (Paramètres) ─────────────────────────────
function serialize(row) {
  return {
    id: row.id,
    name: row.name,
    formula: row.formula,
    lineId: row.line_id,
    themeId: row.theme_id,
    params: all("SELECT * FROM calculator_params WHERE calculator_id = ? ORDER BY sort_order, id", row.id)
      .map((p) => ({ id: p.id, symbol: p.symbol, label: p.label, value: p.value, unit: p.unit })),
    readings: all("SELECT * FROM calculator_reading_defs WHERE calculator_id = ? ORDER BY sort_order, id", row.id)
      .map((d) => ({ id: d.id, symbol: d.symbol, label: d.label, kind: d.kind, unit: d.unit })),
  };
}

export function list() {
  return all("SELECT * FROM calculators ORDER BY sort_order, id").map(serialize);
}

export function getById(id) {
  const row = get("SELECT * FROM calculators WHERE id = ?", id);
  if (!row) throw httpError(404, "Calculateur introuvable");
  return serialize(row);
}

/**
 * Refuse une définition qui ne pourrait pas produire de résultat.
 *
 * Le dernier contrôle est le plus utile : la formule est **évaluée** avec des valeurs
 * factices. Une faute de frappe dans un symbole ou une parenthèse manquante est ainsi
 * signalée à la saisie, et non des semaines plus tard devant une estimation vide.
 *
 * @param {object} definition `{ name, params, readings, formula }`.
 */
function validateDefinition({ name, params = [], readings = [], formula }) {
  if (!(name || "").trim()) throw httpError(400, "Le nom du calculateur est requis");
  const symbols = new Set();
  for (const s of [...params, ...readings]) {
    if (!isValidSymbol(s.symbol)) throw httpError(400, `Symbole invalide : « ${s.symbol || ""} » (lettres, chiffres, _ ; commence par une lettre)`);
    if (symbols.has(s.symbol)) throw httpError(400, `Symbole en double : « ${s.symbol} »`);
    symbols.add(s.symbol);
  }
  for (const r of readings) {
    if (!["index", "valeur"].includes(r.kind || "index")) throw httpError(400, "Type de relevé invalide");
  }
  // La formule doit s'évaluer avec des valeurs factices (syntaxe + symboles connus)
  if ((formula || "").trim()) {
    const vars = Object.fromEntries([...symbols].map((s) => [s, 1]));
    try { evaluate(formula, vars); } catch (e) { throw httpError(400, `Formule : ${e.message}`); }
  }
}

/**
 * Création ou mise à jour complète d'un calculateur.
 *
 * La différence de traitement entre paramètres et relevés est le point à comprendre.
 * Les **paramètres** sont remplacés en bloc : rien n'y est rattaché, ce sont de simples
 * constantes. Les **relevés**, eux, gardent leur id — les saisies de tous les mois
 * passés y pendent. Les effacer pour les recréer emporterait l'historique entier des
 * index avec eux.
 *
 * @param {number|null} id Le calculateur, ou null pour en créer un.
 * @param {object} data `{ name, formula, lineId, themeId, params, readings }`.
 * @returns {object} Le calculateur enregistré.
 */
export function save(id, data) {
  validateDefinition(data);
  return tx(() => {
    let calcId = id;
    if (calcId) {
      if (!get("SELECT id FROM calculators WHERE id = ?", calcId)) throw httpError(404, "Calculateur introuvable");
      run("UPDATE calculators SET name = ?, formula = ?, line_id = ?, theme_id = ? WHERE id = ?",
        data.name.trim(), data.formula || "", data.lineId || null, data.themeId || null, calcId);
    } else {
      const max = get("SELECT COALESCE(MAX(sort_order), -1) AS m FROM calculators").m;
      calcId = Number(run("INSERT INTO calculators (name, formula, line_id, theme_id, sort_order) VALUES (?, ?, ?, ?, ?)",
        data.name.trim(), data.formula || "", data.lineId || null, data.themeId || null, max + 1).lastInsertRowid);
    }

    // Paramètres : remplacement complet (aucune donnée mensuelle n'y est rattachée)
    run("DELETE FROM calculator_params WHERE calculator_id = ?", calcId);
    (data.params || []).forEach((p, i) => {
      run("INSERT INTO calculator_params (calculator_id, symbol, label, value, unit, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
        calcId, p.symbol, p.label || null, Number(p.value) || 0, p.unit || null, i);
    });

    // Relevés : conservés par id, supprimés s'ils ne sont plus dans la liste
    const keep = (data.readings || []).filter((r) => r.id).map((r) => r.id);
    const existing = all("SELECT id FROM calculator_reading_defs WHERE calculator_id = ?", calcId).map((r) => r.id);
    for (const oldId of existing) {
      if (!keep.includes(oldId)) run("DELETE FROM calculator_reading_defs WHERE id = ?", oldId);
    }
    (data.readings || []).forEach((r, i) => {
      if (r.id && existing.includes(r.id)) {
        run("UPDATE calculator_reading_defs SET symbol = ?, label = ?, kind = ?, unit = ?, sort_order = ? WHERE id = ?",
          r.symbol, r.label || null, r.kind || "index", r.unit || null, i, r.id);
      } else {
        run("INSERT INTO calculator_reading_defs (calculator_id, symbol, label, kind, unit, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
          calcId, r.symbol, r.label || null, r.kind || "index", r.unit || null, i);
      }
    });
    return getById(calcId);
  });
}

export function remove(id) {
  if (!get("SELECT id FROM calculators WHERE id = ?", id)) throw httpError(404, "Calculateur introuvable");
  run("DELETE FROM calculators WHERE id = ?", id); // params, relevés et saisies suivent (CASCADE)
  return { message: "Calculateur supprimé" };
}

// Test d'une formule depuis l'éditeur : { ok, value | error }
// Ne lève jamais : l'éditeur affiche l'erreur au fil de la frappe, il ne la subit pas.
export function check(formula, symbols = []) {
  const vars = Object.fromEntries(symbols.map((s) => [s.symbol, Number(s.value) || 1]));
  try {
    return { ok: true, value: evaluate(formula, vars), symbols: symbolsOf(formula) };
  } catch (e) {
    return { ok: false, error: e.message, symbols: symbolsOf(formula) };
  }
}

// ─── Mois : relevés, estimation, écart ───────────────────

/**
 * Crée les relevés manquants du mois, avec leur index de départ.
 *
 * Le report vient du DERNIER index de fin saisi sur un mois antérieur — pas
 * nécessairement le mois juste avant. Un mois sauté n'interrompt donc pas la chaîne :
 * la consommation englobe simplement la période plus longue, ce qui reste juste.
 *
 * Sur un mois clôturé, rien n'est écrit : une simple lecture ne doit pas créer de
 * données, et surtout pas dans un mois verrouillé. La ligne rendue est virtuelle.
 *
 * @param {object} month Le mois en base.
 * @param {Array<object>} defs Les définitions de relevés du calculateur.
 * @returns {Array<object>} Une ligne de relevé par définition.
 */
function ensureReadings(month, defs) {
  return defs.map((def) => {
    let r = get("SELECT * FROM calculator_readings WHERE def_id = ? AND month_id = ?", def.id, month.id);
    if (!r) {
      let prev = null;
      if (def.kind === "index") {
        prev = get(
          `SELECT cr.current_value FROM calculator_readings cr JOIN months m ON m.id = cr.month_id
           WHERE cr.def_id = ? AND m.period < ? AND cr.current_value IS NOT NULL
           ORDER BY m.period DESC LIMIT 1`, def.id, month.period
        )?.current_value ?? null;
      }
      // Mois clôturé : un GET ne doit rien écrire — ligne virtuelle en lecture seule
      if (month.closed_at) return { def_id: def.id, month_id: month.id, previous_value: prev, current_value: null };
      run("INSERT INTO calculator_readings (def_id, month_id, previous_value) VALUES (?, ?, ?)", def.id, month.id, prev);
      r = get("SELECT * FROM calculator_readings WHERE def_id = ? AND month_id = ?", def.id, month.id);
    }
    return r;
  });
}

/**
 * L'état de tous les calculateurs sur un mois : relevés, estimation, écart.
 *
 * L'estimation n'est tentée que si TOUS les relevés sont complets — une formule
 * évaluée avec un trou rendrait un chiffre faux, plus dangereux qu'une case vide.
 * Une erreur de formule est rendue dans `error` plutôt que levée : les autres
 * calculateurs de la page doivent rester affichables.
 *
 * @param {number} monthId Le mois.
 * @returns {Array<object>} Un état par calculateur.
 */
export function monthState(monthId) {
  const month = get("SELECT * FROM months WHERE id = ?", monthId);
  if (!month) throw httpError(404, "Mois introuvable");

  return all("SELECT * FROM calculators ORDER BY sort_order, id").map((calc) => {
    const params = all("SELECT * FROM calculator_params WHERE calculator_id = ? ORDER BY sort_order, id", calc.id);
    const defs = all("SELECT * FROM calculator_reading_defs WHERE calculator_id = ? ORDER BY sort_order, id", calc.id);
    const rows = ensureReadings(month, defs);

    const vars = Object.fromEntries(params.map((p) => [p.symbol, p.value]));
    const readings = defs.map((def, i) => {
      const r = rows[i];
      let consumption = null;
      if (def.kind === "index") {
        if (r.current_value !== null && r.previous_value !== null) consumption = r.current_value - r.previous_value;
      } else if (r.current_value !== null) {
        consumption = r.current_value;
      }
      vars[def.symbol] = consumption;
      return {
        defId: def.id, symbol: def.symbol, label: def.label, kind: def.kind, unit: def.unit,
        previous: r.previous_value, current: r.current_value, consumption,
      };
    });

    let estimate = null;
    let error = null;
    const complete = readings.every((r) => r.consumption !== null);
    if (complete && calc.formula) {
      try { estimate = Math.round(evaluate(calc.formula, vars) * 100) / 100; } catch (e) { error = e.message; }
    }

    // Ligne rattachée sur ce mois (copie de la ligne du template)
    let line = null;
    if (calc.line_id) {
      const l = get(
        `SELECT bl.*, COALESCE((SELECT SUM(e.amount_cents) FROM entries e WHERE e.line_id = bl.id), 0) AS actual_cents,
           COALESCE((SELECT SUM(e.amount_cents) FROM entries e WHERE e.line_id = bl.id AND e.source = 'regularisation'), 0) AS regul_cents
         FROM budget_lines bl WHERE bl.month_id = ? AND bl.template_line_id = ?`, monthId, calc.line_id
      );
      if (l) {
        line = {
          id: l.id, label: l.label,
          planned: fromCents(l.planned_amount_cents),
          actual: fromCents(l.actual_cents),
          regularisation: fromCents(l.regul_cents),
        };
      }
    }
    const gap = estimate !== null && line ? Math.round((estimate - line.planned) * 100) / 100 : null;

    return {
      id: calc.id, name: calc.name, formula: calc.formula, themeId: calc.theme_id,
      params: params.map((p) => ({ symbol: p.symbol, label: p.label, value: p.value, unit: p.unit })),
      readings, estimate, error, line, gap,
    };
  });
}

// Enregistre les relevés saisis. L'UPSERT évite d'avoir à savoir si la ligne du mois
// existait déjà — ensureReadings a pu la créer, ou pas.
export function saveReadings(monthId, calcId, readings) {
  assertOpen(monthId);
  tx(() => {
    for (const r of readings) {
      const def = get("SELECT * FROM calculator_reading_defs WHERE id = ? AND calculator_id = ?", r.defId, calcId);
      if (!def) throw httpError(400, "Relevé inconnu");
      const num = (v) => (v === "" || v === null || v === undefined ? null : Number(v));
      run(
        `INSERT INTO calculator_readings (def_id, month_id, previous_value, current_value) VALUES (?, ?, ?, ?)
         ON CONFLICT (def_id, month_id) DO UPDATE SET previous_value = excluded.previous_value, current_value = excluded.current_value`,
        def.id, monthId, def.kind === "index" ? num(r.previous) : null, num(r.current)
      );
    }
  });
  return monthState(monthId).find((c) => c.id === calcId);
}

/**
 * Régularisation : pose l'écart (estimé − prévu) en entrée sur la ligne rattachée.
 *
 * CE QU'ELLE SUPPOSE — la mensualité du mois est DÉJÀ pointée. L'entrée posée ici est
 * un ÉCART (estimation − prévu), pas un total : elle n'a de sens qu'ajoutée à la
 * mensualité. Posée seule sur une ligne sans entrée, elle serait lue comme le coût du
 * mois entier — la règle « le réel remplace le prévu » ne regarde pas la source — et le
 * projeté sauterait du montant de la mensualité.
 *
 * Laissé tel quel sciemment (décision d'Evan, 08/09) : dans son usage le calculateur est
 * un indicateur qu'il lit sans régulariser, et contraindre l'ordre rendrait l'outil moins
 * général. Le point est documenté plutôt que verrouillé.
 *
 * La précédente régularisation est supprimée d'abord : l'écart est un état, pas un
 * cumul. Rejouer l'opération après avoir corrigé un relevé doit donner le bon montant,
 * pas la somme des deux tentatives. La source `'regularisation'` est ce qui permet de
 * la retrouver et de ne toucher qu'à elle, jamais aux saisies manuelles.
 *
 * @param {number} monthId Le mois, ouvert.
 * @param {number} calcId Le calculateur.
 * @returns {object} L'état du calculateur après régularisation.
 */
export function regularize(monthId, calcId) {
  assertOpen(monthId);
  const state = monthState(monthId).find((c) => c.id === calcId);
  if (!state) throw httpError(404, "Calculateur introuvable");
  if (!state.line) throw httpError(400, "Aucune ligne rattachée sur ce mois");
  if (state.gap === null) throw httpError(400, "Relevés incomplets : impossible d'estimer");
  const cents = toCents(state.gap);
  if (!cents) throw httpError(400, "Aucun écart à régulariser");

  const line = get("SELECT * FROM budget_lines WHERE id = ?", state.line.id);
  tx(() => {
    run("DELETE FROM entries WHERE line_id = ? AND source = 'regularisation'", line.id);
    run(
      `INSERT INTO entries (month_id, line_id, label, amount_cents, account_id, to_account_id, theme_id, is_shared, pot_line_id, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'regularisation')`,
      monthId, line.id, `Régularisation ${state.name}`, cents,
      line.from_account_id ?? get("SELECT id FROM accounts WHERE is_main = 1 LIMIT 1")?.id ?? null,
      line.to_account_id, state.themeId ?? line.theme_id, line.is_shared, line.pot_line_id
    );
  });
  return monthState(monthId).find((c) => c.id === calcId);
}
