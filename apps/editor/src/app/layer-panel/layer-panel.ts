import { Component, computed, inject } from '@angular/core';
import { EditorSession } from '../editor-session';

interface PanelLayer {
  readonly id: string;
  readonly title?: string;
}

/** Drop a hidden layer when another layer with the same title is shown, or when an earlier hidden twin already represents the group. */
export function visiblePanelLayers<T extends PanelLayer>(
  layers: readonly T[],
  isHidden: (layerId: string) => boolean,
): T[] {
  return layers.filter((layer) => {
    if (!isHidden(layer.id)) {
      return true;
    }

    const title = layer.title ?? layer.id;
    const twins = layers.filter(
      (other) => (other.title ?? other.id) === title,
    );
    if (twins.some((other) => !isHidden(other.id))) {
      return false;
    }

    return twins[0] === layer;
  });
}

@Component({
  selector: 'kx-layer-panel',
  templateUrl: './layer-panel.html',
  styleUrl: './layer-panel.css',
})
export class LayerPanel {
  protected readonly session = inject(EditorSession);

  protected readonly layers = computed(() => {
    const plugin = this.session.plugin();
    if (!plugin) {
      return [];
    }

    return visiblePanelLayers(plugin.manifest.layers, (layerId) =>
      this.session.isHidden(layerId),
    );
  });
}
