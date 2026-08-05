import path from 'node:path';
import { resolveAssetPath } from './asset-path.js';

const ROOT = path.resolve('/plugins/sample');

describe('resolveAssetPath', () => {
  it('resolves a relative asset against the plugin root', () => {
    expect(resolveAssetPath(ROOT, 'layers/body/standard.png')).toBe(
      path.join(ROOT, 'layers', 'body', 'standard.png'),
    );
  });

  it('allows a path that walks up but stays inside the root', () => {
    expect(resolveAssetPath(ROOT, 'layers/../shared/base.png')).toBe(
      path.join(ROOT, 'shared', 'base.png'),
    );
  });

  it('refuses a path that escapes the root', () => {
    expect(() => resolveAssetPath(ROOT, '../../etc/passwd')).toThrow(
      /escapes the plugin root/,
    );
  });

  it('refuses an absolute path', () => {
    expect(() => resolveAssetPath(ROOT, path.resolve('/etc/passwd'))).toThrow(
      /must be relative to the plugin root/,
    );
  });
});
