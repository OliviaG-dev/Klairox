import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { RenderLayer, RenderRequest } from '@klairox/core';
import sharp from 'sharp';
import { SharpRenderer } from './sharp-renderer.js';

const CANVAS = { width: 16, height: 16 };
const RED = { r: 255, g: 0, b: 0, alpha: 1 };

interface Pixel {
  r: number;
  g: number;
  b: number;
  a: number;
}

async function readPixel(
  image: Uint8Array,
  x: number,
  y: number,
): Promise<Pixel> {
  const { data, info } = await sharp(Buffer.from(image))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const offset = (y * info.width + x) * info.channels;
  return {
    r: data[offset],
    g: data[offset + 1],
    b: data[offset + 2],
    a: data[offset + 3],
  };
}

describe('SharpRenderer', () => {
  const renderer = new SharpRenderer();
  let workDir: string;

  beforeAll(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), 'klairox-renderer-'));
  });

  afterAll(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  async function writeColor(
    name: string,
    size: number,
    background: { r: number; g: number; b: number; alpha: number },
  ): Promise<string> {
    const filePath = path.join(workDir, name);
    const png = await sharp({
      create: { width: size, height: size, channels: 4, background },
    })
      .png()
      .toBuffer();

    await writeFile(filePath, png);
    return filePath;
  }

  async function writeSquare(name: string, size: number): Promise<string> {
    return writeColor(name, size, RED);
  }

  function layer(
    assetPath: string,
    overrides: Partial<RenderLayer> = {},
  ): RenderLayer {
    return {
      assetPath,
      opacity: 1,
      blendMode: 'normal',
      offset: { x: 0, y: 0 },
      ...overrides,
    };
  }

  function request(overrides: Partial<RenderRequest> = {}): RenderRequest {
    return { canvas: CANVAS, layers: [], format: 'png', ...overrides };
  }

  it('produces an empty transparent canvas of the requested size', async () => {
    const output = await renderer.render(request());
    const metadata = await sharp(Buffer.from(output)).metadata();

    expect({ width: metadata.width, height: metadata.height }).toEqual(CANVAS);
    expect(await readPixel(output, 0, 0)).toMatchObject({ a: 0 });
  });

  it('paints the canvas background when the plugin declares one', async () => {
    const output = await renderer.render(
      request({ canvas: { ...CANVAS, background: '#0000ff' } }),
    );

    expect(await readPixel(output, 0, 0)).toEqual({
      r: 0,
      g: 0,
      b: 255,
      a: 255,
    });
  });

  it('composites a layer at its offset', async () => {
    const square = await writeSquare('red-8.png', 8);
    const output = await renderer.render({
      ...request(),
      layers: [layer(square, { offset: { x: 8, y: 8 } })],
    });

    expect(await readPixel(output, 0, 0)).toMatchObject({ a: 0 });
    expect(await readPixel(output, 8, 8)).toEqual({
      r: 255,
      g: 0,
      b: 0,
      a: 255,
    });
  });

  it('fades a layer whose opacity is below 1', async () => {
    const square = await writeSquare('red-16.png', 16);
    const output = await renderer.render({
      ...request(),
      layers: [layer(square, { opacity: 0.5 })],
    });

    expect((await readPixel(output, 0, 0)).a).toBeCloseTo(128, -1);
  });

  it('multiplies a tint over a light base', async () => {
    const base = await writeColor('white-16.png', 16, {
      r: 200,
      g: 200,
      b: 200,
      alpha: 1,
    });
    const tint = await writeColor('bay-tint-16.png', 16, {
      r: 128,
      g: 64,
      b: 32,
      alpha: 1,
    });
    const output = await renderer.render({
      ...request(),
      layers: [layer(base), layer(tint, { blendMode: 'multiply' })],
    });

    const pixel = await readPixel(output, 0, 0);
    expect(pixel.r).toBeCloseTo(100, -1);
    expect(pixel.g).toBeCloseTo(50, -1);
    expect(pixel.b).toBeCloseTo(25, -1);
    expect(pixel.a).toBe(255);
  });

  it('encodes to webp when asked', async () => {
    const output = await renderer.render(request({ format: 'webp' }));

    expect((await sharp(Buffer.from(output)).metadata()).format).toBe('webp');
  });

  it('downscales after compositing when a resize is requested', async () => {
    const square = await writeSquare('red-16b.png', 16);
    const output = await renderer.render({
      ...request(),
      layers: [layer(square)],
      resizeTo: { width: 8 },
    });

    const metadata = await sharp(Buffer.from(output)).metadata();
    expect({ width: metadata.width, height: metadata.height }).toEqual({
      width: 8,
      height: 8,
    });
    expect(await readPixel(output, 0, 0)).toEqual({
      r: 255,
      g: 0,
      b: 0,
      a: 255,
    });
  });

  it('mixes a pie overlay into dest as opaque colour, not a glass rim', async () => {
    const coat = await writeColor('black-coat-16.png', 16, {
      r: 0,
      g: 0,
      b: 0,
      alpha: 1,
    });
    const piePath = path.join(workDir, 'pie-white-16.png');
    const pie = await sharp({
      create: {
        width: 16,
        height: 16,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 0.5 },
      },
    })
      .png()
      .toBuffer();
    await writeFile(piePath, pie);

    const output = await renderer.render({
      ...request(),
      layers: [layer(coat), layer(piePath, { layerId: 'pie' })],
    });

    expect(await readPixel(output, 0, 0)).toEqual({
      r: 128,
      g: 128,
      b: 128,
      a: 255,
    });
  });

  it('names the layer that does not fit inside the canvas', async () => {
    const square = await writeSquare('red-32.png', 32);

    await expect(
      renderer.render({ ...request(), layers: [layer(square)] }),
    ).rejects.toThrow(
      /red-32\.png" \(32x32 at 0,0\) does not fit in the 16x16 canvas/,
    );
  });

  it('reports which layer image is missing', async () => {
    const missing = path.join(workDir, 'nope.png');

    await expect(
      renderer.render({ ...request(), layers: [layer(missing)] }),
    ).rejects.toThrow(/Cannot read layer image/);
  });
});
