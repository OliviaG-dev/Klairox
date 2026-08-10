import { Component, inject } from '@angular/core';
import { EditorSession } from '../editor-session';

@Component({
  selector: 'kx-preview',
  templateUrl: './preview.html',
  styleUrl: './preview.css',
})
export class Preview {
  protected readonly session = inject(EditorSession);
}
