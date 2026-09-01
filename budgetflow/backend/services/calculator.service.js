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

// Création / mise à jour complète. Les relevés existants gardent leur id (les saisies mensuelles y sont rattachées).
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
export function check(formula, symbols = []) {
  const vars = Object.fromEntries(symbols.map((s) => [s.symbol, Number(s.value) || 1]));
  try {
    return { ok: true, value: evaluate(formula, vars), symbols: symbolsOf(formula) };
  } catch (e) {
    return { ok: false, error: e.message, symbols: symbolsOf(formula) };
  }
}

// ─── Mois : relevés, estimation, écart ───────────────────
// Crée les relevés manquants du mois. Pour un index : report du DERNIER index de fin saisi
// sur un mois antérieur (pas forcément le mois juste avant — un mois sans relevé n'interrompt pas la chaîne).
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
      run("INSERT INTO calculator_readings (def_id, month_id, previous_value) VALUES (?, ?, ?)", def.id, month.id, prev);
      r = get("SELECT * FROM calculator_readings WHERE def_id = ? AND month_id = ?", def.id, month.id);
    }
    return r;
  });
}

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

// Régularisation : pose l'écart (estimé − prévu) en entrée sur la ligne rattachée, remplace la précédente
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
