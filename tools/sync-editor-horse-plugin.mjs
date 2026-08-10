/**
 * Mirrors `plugins/horse` into the Angular editor public folder so the
 * dev-server always serves newly added coat/asset files without a restart.
 *
 * Usage: node tools/sync-editor-horse-plugin.mjs
 */
import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'plugins', 'horse');
const DEST = path.join(ROOT, 'apps', 'editor', 'public', 'plugins', 'horse');

await rm(DEST, { recursive: true, force: true });
await mkdir(path.dirname(DEST), { recursive: true });
await cp(SRC, DEST, { recursive: true });
console.log(`Synced ${path.relative(ROOT, SRC)} → ${path.relative(ROOT, DEST)}`);
