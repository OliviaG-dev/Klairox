import { Component, computed, inject } from '@angular/core';
import { EditorSession } from '../editor-session';

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

    const layers = plugin.manifest.layers;
    return layers.filter((layer) => {
      if (!this.session.isHidden(layer.id)) {
        return true;
      }

      const title = layer.title ?? layer.id;
      const hasVisibleTwin = layers.some(
        (other) =>
          other.id !== layer.id &&
          (other.title ?? other.id) === title &&
          !this.session.isHidden(other.id),
      );
      return !hasVisibleTwin;
    });
  });
}
