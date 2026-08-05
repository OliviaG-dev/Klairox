# @klairox/renderer

The reference renderer for [Klairox](../../README.md), built on Sharp and libvips.

It implements the `Renderer` port defined by [`@klairox/core`](../core), which is the only
thing the engine knows about rasterisation:

```ts
import { SharpRenderer } from '@klairox/renderer';

const renderer = new SharpRenderer({ quality: 9 });
const bytes = await renderer.render(request);
```

It composites layers onto the canvas at their offsets, applies per-layer opacity and blend
modes, and encodes to PNG or WebP. A resize request produces a thumbnail from the composed
image.

Swapping in a Canvas, WebGL or PixiJS backend means implementing the same interface; the
engine does not change.
