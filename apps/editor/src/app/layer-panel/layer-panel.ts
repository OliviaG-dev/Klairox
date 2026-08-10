import { Component, inject } from '@angular/core';
import { EditorSession } from '../editor-session';

@Component({
  selector: 'kx-layer-panel',
  templateUrl: './layer-panel.html',
  styleUrl: './layer-panel.css',
})
export class LayerPanel {
  protected readonly session = inject(EditorSession);
}
