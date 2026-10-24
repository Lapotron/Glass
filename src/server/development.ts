import { promises as fs, watch } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { buildSite } from '../engine/build.js';
import type { Store } from '../engine/store.js';
/** Development artifacts are separate from accepted dist/ and the author's build history. */
export class DevelopmentPreview {
  readonly events = new EventEmitter();
  directory: string;
  generation = randomUUID();
  error = '';
  private watcher?: ReturnType<typeof watch>;
  private timer?: ReturnType<typeof setTimeout>;
  private running = false;
  private dirty = false;
  private closed = false;
  constructor(private root: string) {
    this.directory = path.join(root, 'dist');
  }
  async start(store: Store) {
    await this.rebuild(store);
    this.watchContent(store);
  }
  watchContent(store: Store) {
    this.watcher?.close();
    if (this.closed) return;
    this.watcher = watch(store.content, { recursive: true }, () => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        void this.rebuild(store);
      }, 350);
    });
  }
  async rebuild(store: Store) {
    this.dirty = true;
    if (this.running || this.closed) return;
    this.running = true;
    while (this.dirty && !this.closed) {
      this.dirty = false;
      try {
        const result = await buildSite(store, {
          updateDist: false,
          artifactRoot: path.join(this.root, '.studio/development'),
          onLog: (message) => console.log(`[preview] ${message}`),
        });
        if (this.closed) break;
        const previous = this.directory;
        this.directory = result.outputDir;
        this.generation = randomUUID();
        this.error = '';
        this.events.emit('update', { generation: this.generation, error: '' });
        // Retain the previous generation for in-flight clients; only prune older owned artifacts.
        const base = path.join(this.root, '.studio/development');
        for (const entry of await fs.readdir(base, { withFileTypes: true }))
          if (entry.isDirectory()) {
            const folder = path.join(base, entry.name, 'public');
            if (folder !== this.directory && folder !== previous)
              await fs.rm(path.dirname(folder), { recursive: true, force: true });
          }
      } catch (error) {
        this.error = error instanceof Error ? error.message : 'Development preview failed.';
        console.error(`[preview] ${this.error}`);
        this.events.emit('update', { generation: this.generation, error: this.error });
      }
    }
    this.running = false;
  }
  close() {
    this.closed = true;
    this.watcher?.close();
    clearTimeout(this.timer);
    this.events.emit('close');
    this.events.removeAllListeners();
  }
}
export const developmentReloadScript = `(() => {
  let known, stream;
  const connect = () => {
    stream = new EventSource('/__dev/events');
    stream.onmessage = (event) => {
      const update = JSON.parse(event.data);
      const previous = document.getElementById('glass-development-error');
      if (update.error) {
        const note = previous || document.createElement('aside');
        note.id = 'glass-development-error'; note.setAttribute('role', 'alert');
        Object.assign(note.style, {position:'fixed',bottom:'16px',left:'16px',right:'16px',zIndex:'2147483647',padding:'16px',borderRadius:'12px',background:'var(--surface-solid,#fff)',color:'var(--danger,#a22)',boxShadow:'0 4px 24px #0003',font:'13px/1.5 system-ui',maxHeight:'35vh',overflow:'auto'});
        note.textContent = 'Development preview could not update: ' + update.error;
        if (!previous) document.body.append(note);
      } else {
        previous?.remove();
        if (known && known !== update.generation) { stream.close(); location.reload(); return; }
      }
      known = update.generation;
    };
  };
  connect();
  addEventListener('pagehide', () => stream?.close());
  addEventListener('pageshow', (event) => { if (event.persisted) connect(); });
})();`;
export function withDevelopmentReload(html: string) {
  return html.replace('</body>', '<script src="/__dev/reload.js" defer></script></body>');
}
