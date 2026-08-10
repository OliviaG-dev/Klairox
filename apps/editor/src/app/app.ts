import { Component, inject, OnInit } from '@angular/core';
import { LayerPanel } from './layer-panel/layer-panel';
import { Preview } from './preview/preview';
import { EditorSession } from './editor-session';

@Component({
  imports: [LayerPanel, Preview],
  selector: 'kx-root',
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit {
  protected readonly session = inject(EditorSession);

  ngOnInit(): void {
    void this.session.loadHorsePlugin();
  }
}
