import { t } from '../shared/i18n.js';
import { namespaceDiagramPreviews } from '../shared/diagram-svg.js';
import { registerDiagramViewers, openDiagramViewer } from '../shared/diagram-viewer.js';
import '../shared/diagrams.css';
import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, WidgetType, EditorView, type DecorationSet } from '@codemirror/view';
import {
  componentLabels,
  type SourceComponent,
  type ComponentPreviewResult,
  type ComponentPreviewKind,
} from '../shared/source-components.js';
import { parseSourceTable } from '../shared/source-table.js';
import { api } from './api.js';
import type { MathSettings } from '../shared/math-authoring.js';

export type ComponentAction = (
  block: SourceComponent,
  action: string,
  cell?: { row: number; column: number },
) => void;
const cacheKey = (block: SourceComponent, math?: MathSettings) =>
  block.kind + block.source + block.context + JSON.stringify(math || {});
type Task = {
  block: SourceComponent;
  source: string;
  math?: MathSettings;
  key: string;
  signal: AbortSignal;
  resolve: (result: ComponentPreviewResult) => void;
  reject: (error: Error) => void;
};
class PreviewQueue {
  source = '';
  math?: MathSettings;
  cacheBytes = 0;
  queue: Task[] = [];
  cache = new Map<string, ComponentPreviewResult>();
  timer?: ReturnType<typeof setTimeout>;
  abort?: AbortController;
  busy = false;
  disposed = false;
  setSource(source: string, math?: MathSettings) {
    this.source = source;
    this.math = math;
  }
  request(
    block: SourceComponent,
    source: string,
    math: MathSettings | undefined,
    signal: AbortSignal,
  ) {
    const key = cacheKey(block, math),
      cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return Promise.resolve(cached);
    }
    return new Promise<ComponentPreviewResult>((resolve, reject) => {
      this.queue.push({ block: { ...block }, source, math, key, signal, resolve, reject });
      this.schedule();
    });
  }
  schedule() {
    if (this.busy || this.timer || this.disposed) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.run();
    }, 100);
  }
  async run() {
    if (this.disposed || !this.queue.length) return;
    this.busy = true;
    const waiting = this.queue.splice(0);
    const first = waiting.find((task) => !task.signal.aborted);
    const tasks: Task[] = [];
    for (const task of waiting) {
      if (task.signal.aborted) task.reject(new DOMException('Preview closed', 'AbortError'));
      else if (
        first &&
        tasks.length < 4 &&
        task.source === first.source &&
        JSON.stringify(task.math) === JSON.stringify(first.math)
      )
        tasks.push(task);
      else this.queue.push(task);
    }
    if (!tasks.length) {
      this.busy = false;
      return;
    }
    const abort = (this.abort = new AbortController());
    const timeout = setTimeout(
      () => abort.abort(new Error(t('The local component renderer timed out. Retry the preview.'))),
      25000,
    );
    try {
      const { results } = await api<{ results: ComponentPreviewResult[] }>(
        'authoring/component-preview',
        {
          method: 'POST',
          signal: abort.signal,
          body: JSON.stringify({
            source: tasks[0].source,
            math: tasks[0].math,
            blocks: tasks.map(({ block }) => ({ from: block.from, to: block.to })),
          }),
        },
      );
      if (this.disposed) throw new DOMException('Source changed', 'AbortError');
      if (!Array.isArray(results) || results.length !== tasks.length)
        throw new Error(t('Incomplete component preview response.'));
      tasks.forEach((task, index) => {
        const result = results[index];
        if (typeof result.html !== 'string' && typeof result.error !== 'string')
          throw new Error(t('Invalid component preview response.'));
        if (result.html && result.html.length < 512 * 1024) {
          this.cacheBytes -= (this.cache.get(task.key)?.html?.length || 0) * 2;
          this.cache.delete(task.key);
          this.cache.set(task.key, result);
          this.cacheBytes += result.html.length * 2;
          while (this.cache.size > 48 || this.cacheBytes > 8 * 1024 * 1024) {
            const first = this.cache.keys().next().value!;
            this.cacheBytes -= (this.cache.get(first)?.html?.length || 0) * 2;
            this.cache.delete(first);
          }
        }
        task.resolve(result);
      });
    } catch (error) {
      tasks.forEach((task) => task.reject(error as Error));
    } finally {
      clearTimeout(timeout);
      this.busy = false;
      if (this.queue.length) this.schedule();
    }
  }
  dispose() {
    this.disposed = true;
    this.abort?.abort();
    clearTimeout(this.timer);
    this.queue
      .splice(0)
      .forEach((task) => task.reject(new DOMException('Editor closed', 'AbortError')));
    this.cache.clear();
  }
}

/** A template is inert: strip remote image sources before attaching the fragment. */
export function componentPreviewFragment(html: string, external = false) {
  const template = document.createElement('template');
  template.innerHTML = html;
  template.content.querySelectorAll<HTMLImageElement>('img').forEach((image) => {
    if (!external && !image.getAttribute('src')?.startsWith('/media/')) {
      image.dataset.externalSrc = image.getAttribute('src') || '';
      image.dataset.externalSrcset = image.getAttribute('srcset') || '';
      image.removeAttribute('src');
      image.removeAttribute('srcset');
    }
  });
  template.content.querySelectorAll<HTMLAnchorElement>('a').forEach((link) => {
    if (!link.getAttribute('href')?.startsWith('#')) {
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    }
  });
  namespaceDiagramPreviews(template.content);
  return template.content;
}
class ComponentWidget extends WidgetType {
  private current: SourceComponent;
  readonly math: MathSettings | undefined;
  get block() {
    return this.current;
  }
  constructor(
    block: SourceComponent,
    readonly queue: PreviewQueue,
    readonly action: ComponentAction,
  ) {
    super();
    this.current = block;
    this.math = queue.math;
  }
  eq(other: ComponentWidget) {
    if (cacheKey(this.block, this.math) !== cacheKey(other.block, other.math)) return false;
    this.current = other.block;
    return true;
  }
  get estimatedHeight() {
    return this.block.kind === 'table' ? 220 : 260;
  }
  toDOM(view: EditorView) {
    const wrapper = document.createElement('section'),
      header = document.createElement('header'),
      title = document.createElement('span'),
      tools = document.createElement('div'),
      body = document.createElement('div');
    wrapper.className = 'source-component-widget';
    wrapper.dataset.componentKind = this.block.kind;
    wrapper.setAttribute(
      'aria-label',
      t('{value0} source preview', { value0: componentLabels[this.block.kind] }),
    );
    title.textContent = componentLabels[this.block.kind];
    header.append(title, tools);
    body.className = 'source-component-body prose';
    wrapper.append(header, body);
    let cell = { row: 1, column: 0 };
    const button = (label: string, action: () => void, parent = tools) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'text-link';
      button.textContent = label;
      button.onclick = action;
      parent.append(button);
      return button;
    };
    button(this.block.kind === 'table' ? 'Edit table' : 'Edit', () =>
      this.action(this.block, 'edit', cell),
    );
    let expand: HTMLButtonElement | undefined;
    let disposeDiagrams: (() => void) | undefined;
    if (this.block.kind !== 'table') {
      expand = button('Expand', () => {
        const figure = body.querySelector<HTMLElement>('figure[data-mermaid]');
        if (this.block.kind === 'mermaid' && figure)
          void openDiagramViewer(figure, { trigger: expand }).catch((error) => {
            if (expand) expand.title = (error as Error).message;
          });
        else this.action(this.block, 'expand', cell);
      });
      if (this.block.kind === 'mermaid') expand.disabled = true;
    }
    const more = document.createElement('details'),
      summary = document.createElement('summary'),
      menu = document.createElement('div');
    more.className = 'source-component-more';
    summary.textContent = t('More');
    summary.className = 'text-link';
    summary.setAttribute(
      'aria-label',
      t('{value0} actions', { value0: componentLabels[this.block.kind] }),
    );
    more.append(summary, menu);
    tools.append(more);
    const actions: [string, string][] =
      this.block.kind === 'table'
        ? [
            ['row', 'Add row below'],
            ['column', 'Add column after'],
            ['delete-row', 'Remove row'],
            ['delete-column', 'Remove column'],
            ['left', 'Align left'],
            ['center', 'Align center'],
            ['right', 'Align right'],
            ['format', 'Format table'],
            ['csv', 'Copy CSV'],
            ['tsv', 'Copy TSV'],
          ]
        : this.block.kind === 'image-compare'
          ? [['swap', 'Swap images']]
          : [];
    actions.push(['copy', 'Copy source']);
    actions.forEach(([action, label]) =>
      button(
        label,
        () => {
          more.open = false;
          this.action(this.block, action, cell);
        },
        menu,
      ),
    );
    more.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        more.open = false;
        summary.focus();
      }
    });
    let loading = false;
    const controller = new AbortController();
    const load = () => {
      if (loading || !wrapper.isConnected) return;
      loading = true;
      body.textContent = t('Rendering preview…');
      body.setAttribute('aria-busy', 'true');
      void this.queue
        .request(this.block, view.state.doc.toString(), this.math, controller.signal)
        .then((result) => {
          if (
            !wrapper.isConnected ||
            view.state.doc.sliceString(this.block.from, this.block.to) !== this.block.source
          )
            return;
          body.replaceChildren();
          if (result.error) throw new Error(result.error);
          body.append(componentPreviewFragment(result.html!));
          if (this.block.kind === 'mermaid') {
            disposeDiagrams?.();
            disposeDiagrams = registerDiagramViewers(body, { control: false, trigger: expand });
            if (expand) expand.disabled = false;
          }
          if (body.querySelector('[data-external-src]'))
            button(
              'Load external images',
              () => {
                body.querySelectorAll<HTMLImageElement>('[data-external-src]').forEach((image) => {
                  image.src = image.dataset.externalSrc!;
                  if (image.dataset.externalSrcset) image.srcset = image.dataset.externalSrcset;
                  delete image.dataset.externalSrc;
                  delete image.dataset.externalSrcset;
                });
              },
              body,
            );
          body
            .querySelectorAll('img')
            .forEach((image) => image.addEventListener('load', () => view.requestMeasure()));
          if (this.block.kind === 'table') {
            const table = parseSourceTable(this.block.source);
            title.textContent = t('Table · {value0} × {value1}', {
              value0: table.rows.length - 1,
              value1: table.rows[0].length,
            });
            body.querySelectorAll<HTMLTableRowElement>('table tr').forEach((row, r) => {
              if (r > 12) {
                row.remove();
                return;
              }
              [...row.cells].forEach((element, c) => {
                element.tabIndex = 0;
                element.addEventListener('click', () => {
                  cell = { row: r, column: c };
                  body.querySelector('[data-cell-selected]')?.removeAttribute('data-cell-selected');
                  element.dataset.cellSelected = 'true';
                  const range = table.cells[r]?.[c];
                  if (range)
                    view.dispatch({
                      selection: { anchor: this.block.from + range.from },
                      scrollIntoView: false,
                    });
                });
                element.addEventListener('keydown', (event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    cell = { row: r, column: c };
                    this.action(this.block, 'edit', cell);
                  }
                });
              });
            });
            if (table.rows.length > 13) {
              const note = document.createElement('p');
              note.className = 'help';
              note.textContent = t('First 12 rows shown. Edit table to view all rows.');
              body.append(note);
            }
          }
          view.requestMeasure();
        })
        .catch((error) => {
          if (!wrapper.isConnected) return;
          if (error.name === 'AbortError') {
            loading = false;
            if (
              !controller.signal.aborted &&
              view.state.doc.sliceString(this.block.from, this.block.to) === this.block.source
            )
              setTimeout(load, 200);
            return;
          }
          body.textContent = t('Preview unavailable. {value0}', { value0: error.message });
          button(
            'Retry preview',
            () => {
              loading = false;
              load();
            },
            body,
          );
          view.requestMeasure();
        })
        .finally(() => body.removeAttribute('aria-busy'));
    };
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer?.disconnect();
          load();
        }
      },
      { root: view.scrollDOM, rootMargin: '500px' },
    );
    observer.observe(wrapper);
    (wrapper as HTMLElement & { cleanup?: () => void }).cleanup = () => {
      observer?.disconnect();
      controller.abort();
      disposeDiagrams?.();
    };
    return wrapper;
  }
  destroy(dom: HTMLElement) {
    (dom as HTMLElement & { cleanup?: () => void }).cleanup?.();
  }
  ignoreEvent() {
    return true;
  }
}

export function createSourceComponentPreviews(action: ComponentAction) {
  const queue = new PreviewQueue();
  const update = StateEffect.define<SourceComponent[]>();
  const field = StateField.define<{ blocks: SourceComponent[]; decorations: DecorationSet }>({
    create: () => ({ blocks: [], decorations: Decoration.none }),
    update(value, transaction) {
      let blocks = value.blocks;
      if (transaction.docChanged)
        blocks = blocks
          .filter((block) => !transaction.changes.touchesRange(block.from, block.to))
          .map((block) => ({
            ...block,
            from: transaction.changes.mapPos(block.from),
            to: transaction.changes.mapPos(block.to),
          }));
      for (const effect of transaction.effects) if (effect.is(update)) blocks = effect.value;
      if (blocks === value.blocks) return value;
      return {
        blocks,
        decorations: Decoration.set(
          blocks
            .filter((block) => block.to <= transaction.newDoc.length)
            .map((block) =>
              Decoration.widget({
                widget: new ComponentWidget(block, queue, action),
                side: 1,
                block: true,
              }).range(transaction.newDoc.lineAt(block.to).to),
            ),
          true,
        ),
      };
    },
    provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
  });
  return {
    extension: field,
    source: (source: string, math?: MathSettings) => queue.setSource(source, math),
    update(
      view: EditorView,
      blocks: SourceComponent[],
      enabled: Record<ComponentPreviewKind, boolean>,
    ) {
      view.dispatch({
        effects: update.of(
          blocks.filter((block) => block.kind !== 'pseudocode' && enabled[block.kind]),
        ),
      });
    },
    dispose: () => queue.dispose(),
  };
}
