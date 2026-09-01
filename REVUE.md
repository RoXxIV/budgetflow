# TODO — durcissement validé le 01/09/2026

Implémenté et testé (tests ciblés ✓, revue complète ✓, build front OK). À valider en réel.

- [x] **1a. Enveloppe avec de l'argent** (simplifié après retour du 01/09) : plus jamais de perte d'historique. 🗑 sur une enveloppe avec historique → modal à 2 choix : **clôturer** (l'argent redevient hors enveloppes du hôte) ou **clôturer et réaffecter** le contenu vers **n'importe quelle** enveloppe ouverte ou un compte actif — si la destination est sur un autre compte, virement système dans le mois en cours. La suppression définitive n'existe que pour une enveloppe sans historique (même règle que les comptes).
- [x] **1b. Comptes — désactivation** (révisé après ton test du 01/09) : supprimer un compte avec des données perdait l'historique → remplacé par **désactiver** (`is_active`, migration 016). Un compte désactivé disparaît des saisies, du bilan, du patrimoine et du pré-remplissage des mois ; il reste en bas de la page Comptes, grisé, avec **Réactiver**. Garde-fous : solde connu ≠ 0 → modal « virer le solde vers … puis désactiver » ; enveloppe ouverte hébergée → la clôturer/déplacer d'abord ; **actif ouvert hébergé → pareil** (retour de test : DCA vers Kraken désactivé = argent hors bilan) ; compte principal → en désigner un autre. La **suppression définitive** n'est possible que pour un compte **sans aucun historique** (créé par erreur).
- [x] **2. Enveloppe liée à une ligne mensualisée du template** : suppression refusée (« démensualisez la ligne d'abord »). Supprimer la copie du mois reste possible (elle revient le mois suivant).
- [x] **3. Découvert autorisé** : case par compte (migration 015). Contributions et montants initiaux plus jamais bloqués sur ce compte ; le « hors enveloppes » négatif s'affiche en ambre (bilan du mois + formulaire d'enveloppe).
- [x] **4. ☐ à sens unique** : la case disparaît dès qu'une entrée existe ; elle revient si toutes les entrées sont supprimées et qu'un prévu reste. Les virements système ont leur × individuel ; supprimer la dernière entrée d'une ligne supprime ses virements liés (et l'échéance d'une ligne mensualisée revient au cycle courant).
- [x] **5. Déplacement d'enveloppe vers un autre compte** : modal de confirmation, puis virement système ancien hôte → nouvel hôte du montant de l'enveloppe (aussi depuis « mise de côté sur » du template). Refusé si aucun mois ouvert.

## À tester en réel
- Désactiver un compte (avec et sans solde), vérifier bilan/patrimoine/selects, le réactiver.
- Tenter de supprimer un compte avec historique (doit proposer la désactivation) ; supprimer un compte tout neuf (doit passer).
- Supprimer une enveloppe pleine (les 3 choix).
- Cocher « découvert autorisé » sur un compte et forcer un hors-enveloppes négatif.
- Cocher ☐ payé puis annuler en supprimant l'entrée (×) — vérifier que les virements partent avec et que la case revient.
- Déplacer une enveloppe (Comptes ou « mise de côté sur » du template) et vérifier le virement.

## Plan (validé le 01/09)
Evan chasse les bugs manuellement tant qu'il en trouve ; quand ça se tarit, on migre les checks
(review.mjs + tests de session) vers `node --test` pour consolider — **avant** d'attaquer le design
et les pages stats. Chaque bug trouvé finit en test automatisé avec son fix.

**02/09** — **toutes les pages sont couvertes** : `npm test` depuis backend/ lance 5 suites
(`comptes`, `template`, `mois` — entrées/☐/cagnottes/mensualisation/clôture —, `parametres` —
catégories/thèmes/calculateurs —, `investissements`), **55 tests**, chacune sur sa base neuve jetable
(`tests/_setup.mjs`). `scripts/review.mjs` (83 checks) reste en contrôle global. Bug-hunt Claude au
passage, 3 corrigés : déplacement/création d'enveloppe vers un compte désactivé (l'argent sortait du
bilan), montant initial négatif accepté, renommage synchronisé enveloppe→compte qui contournait
l'unicité des noms.

**Au programme de demain (Evan)** : tests manuels page par page ; chaque bug trouvé → fix + test
dans la suite de la page concernée, même commit.

## Reportés
- **6. Suppression de mois** : à brainstormer après tests (échéances avancées, effets de bord).
- **7. Stats** : exclure virements système et catégories transfert des dépenses (noté pour l'étape stats).
- Réactivation des comptes aussi depuis les Paramètres (plus tard, si utile — pour l'instant bas de la page Comptes).
- Remettre l'ancrage de Strava à juillet quand les tests sont finis (actuellement septembre pour tester).
