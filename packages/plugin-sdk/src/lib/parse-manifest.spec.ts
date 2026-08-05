import { createManifestInput } from './manifest.fixture.js';
import { parsePluginManifest } from './parse-manifest.js';

function expectIssues(input: unknown): readonly string[] {
  const result = parsePluginManifest(input);
  if (result.ok) {
    throw new Error('expected the manifest to be rejected');
  }
  return result.issues.map((issue) => `${issue.path}: ${issue.message}`);
}

describe('parsePluginManifest', () => {
  it('accepts a valid manifest and applies defaults', () => {
    const result = parsePluginManifest(createManifestInput());

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const [body] = result.manifest.layers;
    expect(body.dependsOn).toEqual([]);
    expect(body.opacity).toBe(1);
    expect(body.blendMode).toBe('normal');
    expect(body.offset).toEqual({ x: 0, y: 0 });
    expect(result.manifest.constraints).toEqual([]);
    expect(result.manifest.exports).toEqual({
      formats: ['png'],
      metadata: true,
    });
  });

  it('rejects unknown top-level keys', () => {
    const input = { ...createManifestInput(), renderer: 'sharp' };

    expect(expectIssues(input).join('\n')).toMatch(/renderer/);
  });

  it('rejects identifiers that are not kebab-case', () => {
    const input = createManifestInput({ name: 'Sample Plugin' });

    expect(expectIssues(input)).toContainEqual(
      'name: must be kebab-case (a-z, 0-9, dashes)',
    );
  });

  it('reports a layer depending on an unknown layer', () => {
    const manifest = createManifestInput();
    const layers = [...manifest.layers];
    layers[1] = { ...layers[1], dependsOn: ['ghost'] };

    expect(expectIssues({ ...manifest, layers })).toContainEqual(
      'layers[1].dependsOn[0]: unknown layer "ghost"',
    );
  });

  it('reports a dependency cycle', () => {
    const manifest = createManifestInput();
    const layers = [...manifest.layers];
    layers[0] = { ...layers[0], dependsOn: ['coat'] };

    expect(expectIssues({ ...manifest, layers }).join('\n')).toMatch(
      /dependency cycle detected/,
    );
  });

  it('reports duplicate option ids inside a layer', () => {
    const manifest = createManifestInput();
    const layers = [...manifest.layers];
    layers[1] = {
      ...layers[1],
      options: [
        { id: 'bay', asset: 'a.png' },
        { id: 'bay', asset: 'b.png' },
      ],
    };

    expect(expectIssues({ ...manifest, layers })).toContainEqual(
      'layers[1].options[1].id: duplicate option id "bay" in layer "coat"',
    );
  });

  it('reports constraints pointing at unknown targets', () => {
    const input = createManifestInput({
      constraints: [{ when: { coat: 'grey' }, disable: ['equipment:armor'] }],
    });

    expect(expectIssues(input)).toContainEqual(
      'constraints[0].disable[0]: unknown option "armor" for layer "equipment"',
    );
  });

  it('rejects an option reference in a "hide" target, which only hides whole layers', () => {
    const input = createManifestInput({
      constraints: [{ when: { coat: 'grey' }, hide: ['equipment:saddle'] }],
    });

    expect(expectIssues(input)).toContainEqual(
      'constraints[0].hide[0]: must be kebab-case (a-z, 0-9, dashes)',
    );
  });

  it('rejects a manifest without layers', () => {
    const input = createManifestInput({ layers: [] });

    expect(expectIssues(input).join('\n')).toMatch(/layers/);
  });
});
