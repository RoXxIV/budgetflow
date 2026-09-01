/**
 * Aligne, mois par mois, le cumul de chaque enveloppe « seule sur son compte » sur le solde de
 * début de mois du compte (snapshots importés de Mongo, où l'objectif affichait le solde du compte).
 *
 *   premier mois  : contribution « initiale » = solde de début de mois (remplace le « Montant initial (import) »)
 *   mois suivants : écart = snapshot − cumul au 1er → contribution « ajustement » datée du 1er, notée « Recalage import »
 *
 * Idempotent : les contributions initiales/ajustements posés par l'import ou par ce script sont
 * remplacés à chaque exécution. Les vraies contributions ne sont jamais touchées.
 *
 * Usage : node scripts/align-envelopes.mjs [--dry]
 */
const dry = process.argv.includes("--dry");
const { initDb, all, get, run, tx, fromCents } = await import("../db/index.js");
initDb();

const eur = (n) => (n ?? 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const months = all("SELECT * FROM months ORDER BY period");
const envelopes = all(
  `SELECT e.*, a.name AS account_name FROM envelopes e JOIN accounts a ON a.id = e.account_id
   WHERE e.closed_at IS NULL AND e.account_id IS NOT NULL
     AND (SELECT COUNT(*) FROM envelopes x WHERE x.account_id = e.account_id AND x.closed_at IS NULL) = 1`
);

const work = () => {
  for (const env of envelopes) {
    console.log(`\n── ${env.name} (compte ${env.account_name})`);
    // Contributions techniques précédentes (import / ce script) : on repart propre
    const removed = all(
      `SELECT * FROM envelope_contributions WHERE envelope_id = ?
       AND ((kind = 'initiale' AND notes LIKE '%(import)%') OR notes LIKE 'Recalage import%')`, env.id
    );
    const removedIds = new Set(removed.map((r) => r.id));
    if (removed.length) console.log(`  ${removed.length} contribution(s) technique(s) remplacée(s)`);
    if (!dry) run(`DELETE FROM envelope_contributions WHERE id IN (${[...removedIds].map(() => "?").join(",") || "NULL"})`, ...removedIds);

    let simulated = 0; // ajustements posés (en simulation, non écrits)
    let first = true;
    for (const m of months) {
      const snap = get("SELECT balance_cents FROM account_snapshots WHERE month_id = ? AND account_id = ?", m.id, env.account_id);
      if (!snap) { console.log(`  ${m.period}  pas de solde de début de mois — ignoré`); continue; }
      const start = `${m.period}-01`;
      const real = all("SELECT * FROM envelope_contributions WHERE envelope_id = ? AND date <= ?", env.id, start)
        .filter((c) => !removedIds.has(c.id))
        .reduce((s, c) => s + c.amount_cents, 0);
      const cumul = real + simulated;
      const delta = snap.balance_cents - cumul;
      const kind = first ? "initiale" : "ajustement";
      first = false;
      if (delta === 0) { console.log(`  ${m.period}  cumul ${eur(fromCents(cumul)).padStart(11)}  = solde`); continue; }
      console.log(`  ${m.period}  cumul ${eur(fromCents(cumul)).padStart(11)}  solde ${eur(fromCents(snap.balance_cents)).padStart(11)}  → ${kind.padEnd(10)} ${delta > 0 ? "+" : ""}${eur(fromCents(delta))}`);
      simulated += delta;
      if (!dry) {
        run(
          "INSERT INTO envelope_contributions (envelope_id, amount_cents, date, kind, notes) VALUES (?, ?, ?, ?, ?)",
          env.id, delta, start, kind,
          kind === "initiale"
            ? `Solde initial (import) : solde de ${env.account_name} au 1er ${m.period}`
            : `Recalage import : alignement sur le solde de ${env.account_name} au 1er ${m.period}`
        );
      }
    }
    const realCents = all("SELECT * FROM envelope_contributions WHERE envelope_id = ?", env.id)
      .filter((c) => !dry || !removedIds.has(c.id)).reduce((s, c) => s + c.amount_cents, 0);
    console.log(`  → cumul de l'enveloppe après alignement : ${eur(fromCents(dry ? realCents + simulated : realCents))}${dry ? " (simulation)" : ""}`);
  }
};

if (dry) work(); else tx(work);
