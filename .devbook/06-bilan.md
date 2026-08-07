## Bilan — ce que je réutiliserai ailleurs

### Patterns à emporter

1. **Tags Nx = couches d'architecture**  
   `type:contract | engine | adapter | app` + `enforce-module-boundaries` : applicable à tout framework ou app « hexagonale » dans un monorepo.

2. **Une lib de contrat qui ne dépend de rien**  
   Schéma + types + parse public, sans fuite de Zod / Sharp / Express vers le reste.

3. **Port de rendu / I/O**  
   Interface mince (`render(request) → Uint8Array`), adaptateur isolé : même idée pour un stockage, un mailer, un LLM provider.

4. **Plan pur avant effet de bord**  
   Calculer une structure sérialisable (`CompositionPlan`) puis exécuter l'I/O : idéal pour preview, tests, cache, undo.

5. **Validation en deux passes**  
   Forme (schéma) puis intégrité (refs, cycles) — lisible et testable.

6. **Erreurs agrégées + codes stables**  
   `KlairoxError` avec `code` machine-readable et `details[]` : meilleur DX CLI et futur éditeur.

### Ce qui est spécifique à Klairox

- Domaine assets 2D / couches / contraintes visuelles
- Sharp et les quirks pipeline image
- Plugins data-only comme format d'extension public

### Pour The Dev Book / portfolio

Mettre en avant :

- le **problème** (générateurs hardcodés vs moteur + plugins)
- le **découpage** en 4 packages publiables
- Zod comme **source unique** contrat / types / JSON Schema
- le pipeline jusqu'au plan déterministe

Moins central pour le storytelling : détail de chaque option du plugin horse (reste dans `docs/plugins.md`).

### Suite personnelle

- Réutiliser ce découpage quand l'éditeur Angular arrivera (phase 6) : l'app consomme `core` + un nouveau renderer navigateur
- Comparer avec Stalloria : même Nx, intention différente (jeu full-stack vs framework lib)
- Quand publier sur npm : documenter le versioning semver du contrat plugin (breaking schema = major)
