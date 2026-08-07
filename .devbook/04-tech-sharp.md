## Sharp (libvips)

### Pourquoi ce choix

Le moteur a besoin d'un backend de **composition d'images** (calques, offsets, blend modes, PNG/WebP, miniatures) côté Node. Sharp encapsule libvips : rapide, mature, adapté aux pipelines batch.

Ce n'est **pas** branché dans `@klairox/core` : Sharp vit dans `@klairox/renderer` et implémente le port `Renderer`. On pourra plus tard brancher Canvas / WebGL pour l'éditeur navigateur sans toucher au moteur.

### Première mise en place

```ts
// packages/core — le port (aucune dépendance Sharp)
interface Renderer {
  readonly name: string;
  render(request: RenderRequest): Promise<Uint8Array>;
}
```

```ts
// packages/renderer
export class SharpRenderer implements Renderer {
  readonly name = 'sharp';
  async render(request: RenderRequest): Promise<Uint8Array> { /* … */ }
}
```

Retour en `Uint8Array` (pas `Buffer`) pour rester compatible avec une implémentation navigateur.

### Usage dans ce projet

Fichiers clés :

- `packages/renderer/src/lib/sharp-renderer.ts` — composite + encode
- `layer-image.ts` — préparation d'une couche (dont opacité)
- `blend-modes.ts` — mapping vers les modes Sharp
- `color.ts` — fond canvas hex

Flux typique :

1. créer un canvas RGBA aux dimensions du manifeste
2. préparer chaque couche (asset, offset, blend, opacity)
3. `sharp(...).composite(overlays)`
4. encoder PNG et/ou WebP
5. miniature = **second passage** sur l'image déjà composée

### Pièges rencontrés

- **Pas d'opacité par overlay native** : Sharp ne propose pas d'opacity par composite comme Photoshop. Solution : multiplier le canal alpha de la couche *avant* le composite.
- **Resize vs composite** : dans un seul pipeline Sharp, le resize s'applique avant le composite. Les thumbnails doivent donc partir de l'image déjà composée, pas du même pipeline « create + composite + resize ».
- **Offsets négatifs / calques hors canvas** : volontairement non supportés pour l'instant (limitation documentée dans la roadmap).
- Dépendance native libvips : installer Sharp peut échouer selon plateforme / CI — à anticiper pour la publication et les contributors.

### Ce que j'ai retenu

- Isoler le rendu derrière un port transforme une contrainte Sharp en détail d'adaptateur.
- Toujours vérifier le modèle mental de la lib (ordre des opérations pipeline) avant d'assumer un comportement Photoshop-like.
- Déterminisme : mêmes entrées → mêmes bytes ; utile pour caches et tests de non-régression.

### Ressources

- [Sharp documentation](https://sharp.pixelplumbing.com/)
- [docs/architecture.md](../docs/architecture.md) — section « Rendering is a port »
- `packages/renderer/src/lib/sharp-renderer.ts`
