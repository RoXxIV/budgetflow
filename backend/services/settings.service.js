// Les réglages de l'application, et l'état du parcours de première utilisation.
//
// La table `app_settings` n'a qu'une seule ligne, d'id 1, posée par la migration 001 :
// ce sont des réglages globaux, il n'y a rien à créer ni à choisir.
//
// L'avancement du guide est DÉDUIT du contenu de la base plutôt que mémorisé étape par
// étape. Fermer l'application au milieu de la configuration la fait reprendre au bon
// endroit, sans qu'aucun état ne se désynchronise de la réalité.

import { get, run } from "../db/index.js";

// ─── Première utilisation ─────────────────────────────────
// L'ordre des étapes est imposé par le code : un mois exige un compte actif
// (month.create), et la page Template n'affiche aucun registre sans catégorie.
// Les thèmes et le budget type, eux, sont facultatifs — on peut les remettre à plus tard.
// Le guide ne crée pas de mois : il se termine explicitement, d'où le drapeau
// onboarding_done (migration 021). L'avancement, lui, reste déduit de la base, pour
// qu'une app fermée en cours de route reprenne à la bonne étape.
const ONBOARDING_STEPS = ["compte", "categories", "themes", "template"];

/**
 * Où en est la première utilisation.
 *
 * Le drapeau `onboarding_done` répond à ce que le contenu ne peut pas dire : le guide
 * ne crée pas de mois, rien ne signerait donc sa fin. La présence d'un mois, elle, est
 * un second garde-fou — une installation qui vit sa vie ne doit jamais revoir le guide,
 * même si le drapeau manque (cas d'une base migrée).
 *
 * @returns {object} Ce dont le routeur a besoin pour décider où envoyer l'utilisateur.
 */
export function getOnboarding() {
  const has = (sql, ...params) => !!get(sql, ...params);
  const hasAccounts = has("SELECT id FROM accounts WHERE is_active = 1 LIMIT 1");
  const hasCategories = has("SELECT id FROM categories LIMIT 1");
  const hasThemes = has("SELECT id FROM themes LIMIT 1");
  const hasTemplateLines = has("SELECT id FROM budget_lines WHERE month_id IS NULL LIMIT 1");
  const hasMonths = has("SELECT id FROM months LIMIT 1");
  const flags = get("SELECT onboarding_done, tour_done FROM app_settings WHERE id = 1");
  const done = !!flags?.onboarding_done;
  // La visite des onglets suit le guide : elle ne se joue qu'une fois celui-ci terminé
  const tourDone = !!flags?.tour_done;

  // Un mois déjà créé signe une installation qui vit sa vie : le guide ne s'y impose
  // jamais, même si le drapeau n'a pas été posé.
  const needsOnboarding = !done && !hasMonths;
  let step = null;
  if (needsOnboarding) {
    if (!hasAccounts) step = "compte";
    else if (!hasCategories) step = "categories";
    // Étapes facultatives : dès qu'il y a un thème ou une ligne, la reprise vise le budget type
    else if (!hasThemes && !hasTemplateLines) step = "themes";
    else step = "template";
  }

  return {
    needsOnboarding, step, steps: ONBOARDING_STEPS, done,
    // Visite guidée : elle prend le relais quand le guide est fini et qu'elle n'a pas eu lieu
    needsTour: done && !tourDone,
    tourDone,
    hasAccounts, hasCategories, hasThemes, hasTemplateLines, hasMonths,
  };
}

// Dernière étape franchie : le guide ne reviendra plus, même sans mois créé
export function completeOnboarding() {
  run("UPDATE app_settings SET onboarding_done = 1 WHERE id = 1");
  return getOnboarding();
}

// Visite des onglets terminée (ou passée) : elle ne se rejouera plus
export function completeTour() {
  run("UPDATE app_settings SET tour_done = 1 WHERE id = 1");
  return getOnboarding();
}

function serialize(row) {
  return {
    currency: row.currency,
    savingRate: row.saving_rate,
    paymentMethods: JSON.parse(row.payment_methods),
    investmentTypes: JSON.parse(row.investment_types || "[]"),
  };
}

export function getSettings() {
  return serialize(get("SELECT * FROM app_settings WHERE id = 1"));
}

// Mise à jour partielle : chaque champ absent garde sa valeur actuelle
export function updateSettings(data) {
  const current = get("SELECT * FROM app_settings WHERE id = 1");
  run(
    "UPDATE app_settings SET currency = ?, saving_rate = ?, payment_methods = ?, investment_types = ? WHERE id = 1",
    data.currency ?? current.currency,
    data.savingRate ?? current.saving_rate,
    data.paymentMethods ? JSON.stringify(data.paymentMethods) : current.payment_methods,
    data.investmentTypes ? JSON.stringify(data.investmentTypes) : current.investment_types
  );
  return getSettings();
}
