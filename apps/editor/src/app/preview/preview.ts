import {
  Component,
  effect,
  ElementRef,
  inject,
  viewChild,
} from '@angular/core';
import type { BlendMode } from '@klairox/plugin-sdk';
import { EditorSession, type PreviewLayer } from '../editor-session';
import { isPieOverlayLayer, mixPieOverDest } from './mix-pie-over-dest';

const imageCache = new Map<string, Promise<HTMLImageElement>>();

function loadImage(url: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(url);
  if (cached !== undefined) {
    return cached;
  }

  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => {
      imageCache.delete(url);
      reject(new Error(`Failed to load ${url}`));
    };
    img.src = url;
  });

  imageCache.set(url, promise);
  return promise;
}

function canvasBlendMode(mode: BlendMode): GlobalCompositeOperation {
  switch (mode) {
    case 'multiply':
      return 'multiply';
    case 'screen':
      return 'screen';
    case 'overlay':
      return 'overlay';
    case 'darken':
      return 'darken';
    case 'lighten':
      return 'lighten';
    default:
      return 'source-over';
  }
}

async function drawLayers(
  ctx: CanvasRenderingContext2D,
  layers: readonly PreviewLayer[],
  width: number,
  height: number,
): Promise<void> {
  const images = await Promise.all(
    layers.map(async (layer) => {
      try {
        return await loadImage(layer.url);
      } catch {
        return null;
      }
    }),
  );

  ctx.clearRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  for (let i = 0; i < layers.length; i++) {
    const img = images[i];
    if (img === null) {
      continue;
    }
    const layer = layers[i];
    ctx.save();
    ctx.globalAlpha = layer.opacity;
    ctx.globalCompositeOperation = canvasBlendMode(layer.blendMode);
    if (isPieOverlayLayer(layer.layerId) && layer.blendMode === 'normal') {
      drawPieOverDest(ctx, img, layer, width, height);
    } else {
      ctx.drawImage(img, layer.offsetX, layer.offsetY, width, height);
    }
    ctx.restore();
  }
}

function drawPieOverDest(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  layer: PreviewLayer,
  width: number,
  height: number,
): void {
  const canvas = ctx.canvas;
  const dest = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const off = document.createElement('canvas');
  off.width = canvas.width;
  off.height = canvas.height;
  const overlay = off.getContext('2d');
  if (overlay === null) {
    ctx.drawImage(img, layer.offsetX, layer.offsetY, width, height);
    return;
  }
  overlay.imageSmoothingEnabled = true;
  overlay.imageSmoothingQuality = 'high';
  overlay.globalAlpha = layer.opacity;
  const sx = canvas.width / width;
  const sy = canvas.height / height;
  overlay.drawImage(
    img,
    layer.offsetX * sx,
    layer.offsetY * sy,
    canvas.width,
    canvas.height,
  );
  const src = overlay.getImageData(0, 0, canvas.width, canvas.height);
  mixPieOverDest(dest.data, src.data);
  ctx.putImageData(dest, 0, 0);
}

@Component({
  selector: 'kx-preview',
  templateUrl: './preview.html',
  styleUrl: './preview.css',
})
export class Preview {
  protected readonly session = inject(EditorSession);
  private readonly canvasRef =
    viewChild<ElementRef<HTMLCanvasElement>>('stageCanvas');

  constructor() {
    effect(() => {
      const plugin = this.session.plugin();
      const layers = this.session.previewLayers();
      const canvas = this.canvasRef()?.nativeElement;

      if (plugin === null || canvas === undefined) {
        return;
      }

      const { width, height } = plugin.manifest.canvas;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      const ctx = canvas.getContext('2d');
      if (ctx === null) {
        return;
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      void drawLayers(ctx, layers, width, height);
    });
  }
}
