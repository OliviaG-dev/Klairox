## Zod 4

### Pourquoi ce choix

Le manifeste plugin est le **contrat public** du framework. Il fallait une seule source pour :

1. valider à l'exécution (`parsePluginManifest`)
2. typer TypeScript
3. publier un JSON Schema pour l'autocomplétion éditeur

Zod 4 centralise ça dans `@klairox/plugin-sdk`. Alternative : JSON Schema écrit à la main + types séparés (dérive garantie), ou TypeBox. Zod a été choisi pour l'ergonomie TS et la génération de JSON Schema depuis les mêmes définitions.

### Première mise en place

Schémas stricts dans `packages/plugin-sdk/src/lib/manifest.schema.ts` :

```ts
import { z } from 'zod';

export const identifierSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'must be kebab-case (a-z, 0-9, dashes)');

export const layerOptionSchema = z.strictObject({
  id: identifierSchema,
  asset: z.string().min(1),
  tags: z.array(z.string().min(1)).default([]),
});
```

`z.strictObject` rejette les clés inconnues — important pour des plugins non fiables.

Génération du fichier éditeur :

```bash
npm run schema   # → schemas/plugin.schema.json
```

Dans un `plugin.json` :

```json
{ "$schema": "../../schemas/plugin.schema.json" }
```

### Usage dans ce projet

| Fichier / API                      | Rôle                                         |
| ---------------------------------- | -------------------------------------------- |
| `manifest.schema.ts`               | Définitions Zod                              |
| `parse-manifest.ts`                | Parse + résultat plain (Zod ne fuit pas)     |
| `manifest-integrity.ts`            | 2ᵉ passe : unicité, refs, cycles `dependsOn` |
| `tools/generate-plugin-schema.mjs` | Écrit le JSON Schema                         |

Validation en **deux passes** :

1. forme des champs (Zod)
2. intégrité référentielle (fonction pure) — trop illisible à exprimer dans le schéma seul

### Pièges rencontrés

- Faire dériver types _et_ JSON Schema sans versionner le script `schema` → le fichier généré doit rester synchronisé (CI / `npm run check` mental).
- Laisser Zod traverser la frontière SDK → le reste du monorepo consommerait une lib de validation au lieu d'un contrat stable.
- Defaults Zod (`required: false` par défaut, tags `[]`) : bien documenter ce que le loader remplit vs ce que l'auteur doit écrire.

### Ce que j'ai retenu

- **Une définition = vérité unique** pour runtime, types et IDE.
- Séparer schéma de forme et règles d'intégrité garde le schéma lisible.
- Exposer un parse qui renvoie un résultat plain (pas le type Zod interne) protège l'API publique.

### Ressources

- [Zod documentation](https://zod.dev/)
- [docs/plugins.md](../docs/plugins.md) — référence manifeste
- `packages/plugin-sdk/src/lib/manifest.schema.ts`
