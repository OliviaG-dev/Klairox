## Architecture plugin data-driven

### Pourquoi ce choix

Objectif produit : **un nouveau type d'asset = un dossier de données**, pas une branche de code dans le moteur. Le pattern :

- le **contrat** dit ce qu'un manifeste peut contenir
- le **moteur** résout, planifie, exporte
- le **plugin** n'est jamais exécuté (pas de JS dans le plugin)

C'est proche d'une architecture hexagonale / ports & adapters, appliquée à un framework d'assets plutôt qu'à une API métier.

### Première mise en place

Découpage volontaire dès le début :

| Couche | Package | Connaît |
|--------|---------|---------|
| Contrat | `plugin-sdk` | Structure du manifeste |
| Moteur | `core` | Contrat uniquement |
| Adaptateur | `renderer` | Port `Renderer` + Sharp |
| App | `cli` | Tout (composition root) |

Le plugin d'exemple `plugins/horse` valide le modèle de bout en bout (info / validate / generate).

### Usage dans ce projet

#### Résolution de sélection

Les couches sont parcourues en ordre **`dependsOn`**, pas en ordre de peinture :

1. rejeter les options inconnues
2. pour chaque couche : évaluer les contraintes sur la sélection *déjà* résolue ; appliquer choix utilisateur ou défaut ; sinon laisser vide si optionnelle
3. revalider les `require` sur la sélection finale

Ainsi, « body = heavy » peut restreindre les coats aval **sans code** dans le plugin.

#### `order` vs `dependsOn`

| Champ | Signification |
|-------|----------------|
| `order` | z-index (peint en premier = plus bas) |
| `dependsOn` | ordre de résolution des choix |

Une couche peut être peinte en dernier et résolue en premier. Les confondre casse soit le rendu, soit les règles.

#### Contraintes

Une contrainte matche si chaque entrée de `when` matche la sélection (valeur seule ou liste). Effets :

- `disable` — option ou couche non choisissable
- `hide` — couche choisie mais non peinte (casque qui cache les oreilles)
- `require` — échec si la cible n'est pas sélectionnée

`disable` ≠ `hide` : c'est intentionnel.

#### Événements

Bus typé (`plugin:loaded`, `selection:resolved`, `composition:planned`, `asset:rendered`, `asset:exported`) : le même core peut piloter CLI, éditeur Angular, ou shell desktop. Un listener qui throw n'empêche pas les autres.

#### Sécurité plugins

- chemins d'assets résolus sous la racine plugin (rejet si escape / absolu)
- schéma strict
- **aucune exécution** de code plugin

### Pièges rencontrés

- Vouloir « juste un peu de logique » dans le plugin : ça casse le modèle data-only et la promesse sécurité.
- Erreurs trop pauvres (« invalid selection ») : remonter l'**id de contrainte** qui a refusé change complètement l'UX auteur de plugins.
- Coupler export et Sharp : l'export (noms de fichiers, sidecar) reste dans le core ; le renderer ne fait que des bytes.

### Ce que j'ai retenu

- Data-driven + contraintes déclaratives scale mieux qu'un générateur hardcodé pour chaque asset type.
- Un `CompositionPlan` sérialisable est le bon artefact entre UI et rendu.
- Les erreurs agrégées (toutes les issues d'un manifeste / tous les assets manquants) sont un investissement rentable pour les auteurs de plugins.

### Ressources

- [docs/architecture.md](../docs/architecture.md)
- [docs/plugins.md](../docs/plugins.md)
- [docs/roadmap.md](../docs/roadmap.md)
- `packages/core/src/lib/selection/resolve-selection.ts`
- `packages/core/src/lib/engine.ts`
