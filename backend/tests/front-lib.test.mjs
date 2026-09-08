// Tests unitaires — les modules PURS du frontend.
//
// POURQUOI DEPUIS ICI — `frontend/` n'a aucun outillage de test, et en monter un pour
// trois fichiers serait disproportionné. Or ces modules-là sont du JavaScript ordinaire :
// ni Vue, ni DOM, ni appel réseau. Ils s'importent donc tels quels depuis les suites du
// backend, et tournent avec le reste au même `npm test`.
//
// La voie a été ouverte par `lib/potCalc.js` (revue du 08/09), dont un test différentiel
// a attrapé une divergence d'un centime avec le serveur. Ce fichier étend le principe
// aux autres modules purs : le formatage des montants, et les listes proposées au
// premier lancement.
//
// Ce qui N'EST PAS testable ainsi, et reste hors de portée : tout ce qui touche au
// document, au localStorage ou à l'API — `theme.js`, `privacy.js`, `onboarding.js`,
// `useDialog.js`. Ceux-là demanderaient un vrai environnement de test frontend.
import { test } from "node:test";
import assert from "node:assert/strict";
import { eur } from "../../frontend/src/lib/format.js";
import { CATEGORY_PRESETS, CATEGORY_PALETTE, CATEGORY_TYPES } from "../../frontend/src/lib/categories.js";
import { THEME_PRESETS } from "../../frontend/src/lib/themes.js";

// ═══ Le formatage des montants ═══
// Une espace fine insécable (U+202F) sépare les milliers et précède le €.

test("un montant s'écrit à la française, espaces fines comprises", () => {
  assert.equal(eur(1234.5), "1 234,50 €");
  assert.equal(eur(0), "0,00 €");
  assert.equal(eur(7), "7,00 €");
});

test("aucune espace ordinaire ne subsiste : c'est tout l'objet du remplacement", () => {
  // Intl produit U+00A0 ; sans la substitution, la typographie serait plus lâche
  for (const v of [1000, 1234567.89, -4200]) {
    assert.equal(eur(v).includes(" "), false, `${v} garde une espace insécable ordinaire`);
  }
});

test("un montant absent vaut zéro, jamais « NaN € »", () => {
  assert.equal(eur(null), "0,00 €");
  assert.equal(eur(undefined), "0,00 €");
});

test("un montant négatif garde son signe devant", () => {
  assert.equal(eur(-12.34), "-12,34 €");
});

test("l'arrondi est à deux décimales, toujours", () => {
  // 1.005 vaut un cheveu AU-DESSUS de 1,005 en flottant : il monte donc à 1,01
  assert.equal(eur(1.005), "1,01 €");
  assert.equal(eur(1.999), "2,00 €");
  assert.equal(eur(0.1 + 0.2), "0,30 €", "et absorbe la dérive des flottants à l'affichage");
});

// ═══ Les listes proposées au premier lancement ═══
// Elles sont partagées entre les Paramètres et le guide de bienvenue : un seul
// endroit fait foi, et ce qui suit vérifie qu'il reste cohérent.

test("chaque catégorie proposée a un type connu et une couleur de la palette", () => {
  assert.ok(CATEGORY_PRESETS.length > 0);
  const types = new Set(CATEGORY_TYPES.map((t) => t.value ?? t));
  for (const c of CATEGORY_PRESETS) {
    assert.ok(c.name?.trim(), "un nom non vide");
    assert.ok(types.has(c.type), `« ${c.name} » : type « ${c.type} » inconnu`);
    assert.ok(CATEGORY_PALETTE.includes(c.color), `« ${c.name} » : couleur hors palette fermée`);
  }
});

test("aucune catégorie proposée en double", () => {
  const noms = CATEGORY_PRESETS.map((c) => c.name.trim().toLowerCase());
  assert.equal(new Set(noms).size, noms.length, "un doublon ferait échouer la création au premier lancement");
});

test("la palette des catégories est fermée, et sans doublon", () => {
  assert.ok(CATEGORY_PALETTE.length >= 12, "au moins les douze pastilles annoncées");
  assert.equal(new Set(CATEGORY_PALETTE).size, CATEGORY_PALETTE.length);
});

test("au moins une catégorie de revenu est proposée", () => {
  // Sans elle, un premier lancement ne pourrait pas enregistrer de salaire
  assert.ok(CATEGORY_PRESETS.some((c) => c.type === "revenu"));
});

test("chaque thème proposé a un nom, et aucun doublon", () => {
  assert.ok(THEME_PRESETS.length > 0);
  const noms = THEME_PRESETS.map((t) => (t.name ?? t).trim().toLowerCase());
  assert.ok(noms.every((n) => n.length > 0));
  assert.equal(new Set(noms).size, noms.length);
});
