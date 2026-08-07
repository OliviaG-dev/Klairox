## Nx — packages publiables et boundaries

### Pourquoi ce choix

Sur Stalloria, Nx orchestre des **apps** (Angular, Nest) et des libs métier. Sur Klairox, l'objectif est différent : un **framework** découpé en quatre packages **buildables et publiables** (`@klairox/*`), avec un graphe de dépendances que le lint refuse de laisser pourrir.

Alternative : un seul package monolithique, ou Turborepo sans règles de tags. Nx a été gardé pour le cache, le graphe, et surtout `@nx/enforce-module-boundaries` branché sur des tags d'architecture (`type:contract` → `type:engine` → `type:adapter` → `type:app`).

### Première mise en place

Workspace npm workspaces + packages sous `packages/` :

```
packages/
  plugin-sdk/   # type:contract
  core/         # type:engine
  renderer/     # type:adapter
  cli/          # type:app
```

Chaque `package.json` porte ses tags Nx, par exemple :

```json
"nx": {
  "name": "plugin-sdk",
  "tags": ["type:contract"]
}
```

Les contraintes sont déclarées dans `eslint.config.mjs` : le contrat ne dépend de rien, le moteur seulement du contrat, l'adaptateur du contrat + moteur, l'app de tout.

```bash
npm run build
npm run check
npx nx graph
```

### Usage dans ce projet

| Projet       | Tag             | Dépend de            |
| ------------ | --------------- | -------------------- |
| `plugin-sdk` | `type:contract` | —                    |
| `core`       | `type:engine`   | `plugin-sdk`         |
| `renderer`   | `type:adapter`  | `core`, `plugin-sdk` |
| `cli`        | `type:app`      | les trois            |

Points spécifiques framework (vs app Stalloria) :

- `enforceBuildableLibDependency: true` — une lib consommée doit être buildable
- exports conditionnels `"@klairox/source"` pour pointer vers les sources en monorepo
- CLI comme **seul** composition root (c'est elle qui choisit `SharpRenderer`)
- cible future : `nx release` pour publier le scope `@klairox` sur npm

### Pièges rencontrés

- Un import « pratique » du renderer depuis le core casserait immédiatement l'architecture — le lint existe pour ça.
- Confondre tags métier (`scope:…`) et tags de **couche** (`type:…`) : ici seuls les `type:*` portent la règle hexagonale.
- Oublier de rebuild avant `npm run klairox` : le bin pointe vers `packages/cli/dist/bin.js`.

### Ce que j'ai retenu

- Les boundaries Nx sont le meilleur garde-fou quand on veut un framework découpé en ports.
- Pour un monorepo « lib », penser **publishability** et cache dès le premier package, pas après.
- Le CLI / l'app future (éditeur Angular) doivent rester les seuls endroits qui assemblent.

### Ressources

- [Nx module boundaries](https://nx.dev/features/enforce-module-boundaries)
- [Nx release](https://nx.dev/features/manage-releases)
- [docs/architecture.md](../docs/architecture.md) dans ce repo
