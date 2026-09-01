# TODO — durcissement validé le 01/09/2026

Implémenté et testé (15 tests ciblés ✓, revue complète 83/83 ✓, build front OK). À valider en réel.

- [x] **1a. Enveloppe avec de l'argent** : suppression → modal avec 3 choix : **clôturer** (recommandé, historique conservé, réouvrable), **supprimer et libérer** (l'argent redevient hors enveloppes, aucun mouvement), **supprimer et réaffecter** vers une autre enveloppe du compte.
- [x] **1b. Compte avec un solde** : suppression → modal « virer le solde (X €) vers [compte] puis supprimer » ; un virement système est enregistré dans le mois en cours. Solde inconnu → simple avertissement comme avant.
- [x] **2. Enveloppe liée à une ligne mensualisée du template** : suppression refusée (« démensualisez la ligne d'abord »). Supprimer la copie du mois reste possible (elle revient le mois suivant).
- [x] **3. Découvert autorisé** : case par compte (migration 015). Contributions et montants initiaux plus jamais bloqués sur ce compte ; le « hors enveloppes » négatif s'affiche en ambre (bilan du mois + formulaire d'enveloppe).
- [x] **4. ☐ à sens unique** : la case disparaît dès qu'une entrée existe ; elle revient si toutes les entrées sont supprimées et qu'un prévu reste. Les virements système ont leur × individuel ; supprimer la dernière entrée d'une ligne supprime ses virements liés (et l'échéance d'une ligne mensualisée revient au cycle courant).
- [x] **5. Déplacement d'enveloppe vers un autre compte** : modal de confirmation, puis virement système ancien hôte → nouvel hôte du montant de l'enveloppe (aussi depuis « mise de côté sur » du template). Refusé si aucun mois ouvert.

## À tester en réel
- Supprimer une enveloppe pleine (les 3 choix), supprimer un compte avec solde.
- Cocher « découvert autorisé » sur N26 et forcer un hors-enveloppes négatif.
- Cocher ☐ payé puis annuler en supprimant l'entrée (×) — vérifier que les virements partent avec et que la case revient.
- Déplacer une enveloppe (Comptes ou « mise de côté sur » du template) et vérifier le virement.

## Reportés
- **6. Suppression de mois** : à brainstormer après tests (échéances avancées, effets de bord).
- **7. Stats** : exclure virements système et catégories transfert des dépenses (noté pour l'étape stats).
- Remettre l'ancrage de Strava à juillet quand les tests sont finis (actuellement septembre pour tester).
