// Tests unitaires — périmètre « première utilisation » : l'ordre des étapes du guide.
// Base SQLite neuve et jetable : elle part exactement dans l'état d'un premier lancement.
// Les tests sont séquentiels et partagent cette base, qu'ils font avancer étape par étape.
// Lancer depuis backend/ : `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { boot, refuse, currentPeriod } from "./_setup.mjs";

const S = await boot();
const { accounts, categories, themes, budgetLines, months, settings } = S;

// L'état d'onboarding tel que le front le lira au démarrage
const state = () => settings.getOnboarding();

test("base neuve : tout est vide, la première étape est le compte", () => {
  const s = state();
  assert.equal(s.needsOnboarding, true);
  assert.equal(s.step, "compte");
  assert.deepEqual(s.steps, ["compte", "categories", "themes", "template"]);
  assert.equal(s.done, false, "le guide n'a pas encore été mené à son terme");
  assert.equal(s.needsTour, false, "la visite ne se joue qu'après le guide, pas pendant");
  assert.equal(s.tourDone, false);
  assert.equal(s.hasAccounts, false);
  assert.equal(s.hasCategories, false);
  assert.equal(s.hasThemes, false);
  assert.equal(s.hasTemplateLines, false);
  assert.equal(s.hasMonths, false);
});

test("sans compte, créer un mois est refusé : c'est ce qui impose l'étape 1", () => {
  refuse(() => months.create({ period: currentPeriod() }), 409);
});

test("étape 1 — un compte créé fait passer aux catégories, et devient principal d'office", () => {
  accounts.create({ name: "Compte courant", type: "courant", initialBalance: 1000 });
  assert.ok(accounts.list()[0].isMain, "seul compte : aucun choix à faire");
  const s = state();
  assert.equal(s.hasAccounts, true);
  assert.equal(s.step, "categories");
  assert.equal(s.needsOnboarding, true, "le guide continue tant qu'il n'est pas terminé");
});

test("étape 2 — une catégorie créée fait passer aux thèmes", () => {
  categories.create({ name: "Charges du logement", type: "depense" });
  const s = state();
  assert.equal(s.hasCategories, true);
  assert.equal(s.step, "themes");
});

// Le garde de routage laisse sortir vers la page Template pendant le guide, mais seulement
// quand elle a de quoi s'afficher : sans catégorie, elle ne montre aucun registre.
// C'est `hasCategories` qui porte cette autorisation — d'où ce test.
test("l'ouverture de la page Template suit les catégories, pas l'étape en cours", () => {
  const s = state();
  assert.equal(s.hasCategories, true, "catégories créées → la page Template a de quoi s'afficher");
  assert.equal(s.steps.indexOf("template"), 3, "le budget type reste la dernière étape du fil");
});

test("étape 3 — les thèmes sont facultatifs : un thème créé fait passer au budget type", () => {
  themes.create({ name: "Voiture" });
  const s = state();
  assert.equal(s.hasThemes, true);
  assert.equal(s.step, "template");
});

test("étape 4 — le budget type se remplit sans faire avancer le guide plus loin", () => {
  const cat = categories.list()[0];
  budgetLines.create(null, { label: "Loyer", categoryId: cat.id, plannedAmount: 800 });
  const s = state();
  assert.equal(s.hasTemplateLines, true);
  assert.equal(s.step, "template", "c'est la dernière étape : elle ne mène nulle part d'autre");
  assert.equal(s.hasMonths, false, "le guide ne crée aucun mois");
});

test("« Terminer » clôt le guide sans créer de mois, et passe la main à la visite", () => {
  const s = settings.completeOnboarding();
  assert.equal(s.done, true);
  assert.equal(s.needsOnboarding, false, "le guide ne s'impose plus");
  assert.equal(s.step, null);
  assert.equal(s.hasMonths, false, "et toujours aucun mois : il se crée depuis la page Mois");
  assert.equal(s.needsTour, true, "la visite des onglets prend le relais");
});

test("la visite terminée ou passée ne se rejoue jamais", () => {
  const s = settings.completeTour();
  assert.equal(s.tourDone, true);
  assert.equal(s.needsTour, false);
  assert.equal(s.needsOnboarding, false, "et le guide reste clos");
});

test("une fois terminé, le guide ne dépend plus de rien d'autre que son drapeau", () => {
  // Le drapeau seul décide : inutile de vider catégories, thèmes ou budget type pour
  // le vérifier — un test ne détruit pas des données pour prouver un point.
  const s = state();
  assert.equal(s.done, true);
  assert.equal(s.needsOnboarding, false, "le drapeau tient : ce n'est plus un nouveau venu");
  assert.equal(s.step, null, "aucune étape n'est proposée");
});

// Deuxième filet : une base déjà remplie ne doit jamais retomber dans le guide, même si
// le drapeau n'a pas été posé — le cas des bases antérieures à la migration 021.
test("un mois existant suffit à écarter le guide", () => {
  months.create({ period: currentPeriod() });
  const s = state();
  assert.equal(s.hasMonths, true);
  assert.equal(s.needsOnboarding, false, "un mois créé signe une installation qui vit sa vie");
});
