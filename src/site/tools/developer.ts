import {
  developerTools,
  canSaveToolDraft,
  toolLimits,
  type ToolId,
} from '../../shared/tools-catalog.js';
import { base64Decode, encryptedTextPrefix } from '../../shared/tools-crypto.js';
import { setUiText } from '../../shared/i18n.js';
import { element, button, field, select, input, copyText, download, errorText } from './dom.js';
import { createToolEditor, type ToolEditor } from './editor.js';
import { ToolWorker } from './worker-client.js';
import { readToolDraft, writeToolDraft, deleteToolDraft } from './storage.js';
import type { DeveloperRequest } from './developer.worker.js';
import type { ToolOptions, ToolResult } from './operations.js';
type WorkerInput = DeveloperRequest extends infer R
  ? R extends { id: number }
    ? Omit<R, 'id'>
    : never
  : never;
export type ToolMemory = { source: string; options: ToolOptions; remember: boolean };
export async function openDeveloperTool(
  host: HTMLElement,
  id: ToolId,
  favorite: boolean,
  toggleFavorite: () => boolean,
  memory?: ToolMemory,
) {
  const tool = developerTools.find((tool) => tool.id === id)!;
  let disposed = false,
    sequence = 0,
    saveTimer: ReturnType<typeof setTimeout> | undefined;
  const worker = new ToolWorker<DeveloperRequest, ToolResult>(
    () => new Worker(new URL('./developer.worker.ts', import.meta.url), { type: 'module' }),
  );
  const heading = element('header', 'tools-workspace-heading'),
    title = element('div');
  title.append(
    element('span', 'eyebrow', tool.group),
    element('h2', '', tool.label),
    element('p', 'help', tool.description),
  );
  const pin = button(
    'Favorite',
    () => {
      pin.setAttribute('aria-pressed', String(toggleFavorite()));
    },
    'Pin',
    'text-link tools-pin',
  );
  pin.setAttribute('aria-pressed', String(favorite));
  heading.append(title, pin);
  const toolbar = element('div', 'tools-control-row'),
    options: ToolOptions = {},
    controls = new Map<string, HTMLInputElement | HTMLSelectElement>();
  const state = element('p', 'tools-status');
  state.setAttribute('role', 'status');
  const draftStatus = element('span', 'help'),
    remember = input('Remember this draft', '', 'checkbox');
  const draftControl = element('label', 'tools-remember');
  draftControl.append(remember, element('span', '', 'Remember this draft'));
  draftControl.hidden = !canSaveToolDraft(id);
  const save = () => {
    clearTimeout(saveTimer);
    if (disposed || !remember.checked || !canSaveToolDraft(id)) return;
    saveTimer = setTimeout(() => {
      if (disposed || !remember.checked) return;
      const source = sourceEditor?.value() || '',
        savedOptions = { ...options, ...(diff ? { after: diff.value('after') } : {}) };
      void writeToolDraft({
        id,
        source: diff?.value('before') ?? source,
        options: savedOptions,
        updated: Date.now(),
      })
        .then(() => {
          if (!disposed) setUiText(draftStatus, 'Saved on this device.');
        })
        .catch((error) => {
          if (!disposed) setUiText(draftStatus, errorText(error));
        });
    }, 600);
  };
  const choice = (label: string, key: string, rows: readonly (readonly [string, string])[]) => {
    const node = select(label, rows, () => {
      options[key] = node.value;
      invalidate();
      save();
    });
    controls.set(key, node);
    options[key] = node.value;
    toolbar.append(field(label, node));
    return node;
  };
  const parameter = (label: string, key: string, value: string) => {
    const node = input(label, value);
    options[key] = value;
    node.addEventListener('input', () => {
      options[key] = node.value;
      invalidate();
      save();
    });
    controls.set(key, node);
    toolbar.append(field(label, node));
    return node;
  };
  if (id === 'json') {
    choice('Action', 'action', [
      ['format', 'Format'],
      ['minify', 'Minify'],
    ]);
    choice('Indentation', 'indent', [
      ['2', '2 spaces'],
      ['4', '4 spaces'],
    ]);
  }
  if (id === 'yaml')
    choice('Conversion', 'action', [
      ['to-json', 'YAML → JSON'],
      ['to-yaml', 'JSON → YAML'],
    ]);
  if (id === 'csv')
    choice('Conversion', 'action', [
      ['to-json', 'CSV → JSON'],
      ['to-csv', 'JSON → CSV'],
    ]);
  if (id === 'url')
    choice('Action', 'action', [
      ['encode', 'Encode component'],
      ['decode', 'Decode component'],
      ['inspect', 'Inspect URL'],
    ]);
  if (id === 'base64') {
    choice('Action', 'action', [
      ['encode', 'Encode text'],
      ['decode', 'Decode text'],
      ['file', 'Decode to file'],
    ]);
    choice('Alphabet', 'urlSafe', [
      ['false', 'Standard Base64'],
      ['true', 'URL-safe Base64'],
    ]);
  }
  if (id === 'hash')
    choice('Algorithm', 'algorithm', [
      ['SHA-256', 'SHA-256'],
      ['SHA-384', 'SHA-384'],
      ['SHA-512', 'SHA-512'],
    ]);
  if (id === 'time')
    choice('Input format', 'action', [
      ['', 'Automatic'],
      ['seconds', 'Unix seconds'],
      ['milliseconds', 'Unix milliseconds'],
    ]);
  if (id === 'number')
    choice('Input base', 'base', [
      ['10', 'Decimal'],
      ['2', 'Binary'],
      ['8', 'Octal'],
      ['16', 'Hexadecimal'],
    ]);
  if (id === 'text')
    choice('Action', 'action', [
      ['stats', 'Statistics'],
      ['upper', 'UPPERCASE'],
      ['lower', 'lowercase'],
      ['slug', 'URL slug'],
      ['trim', 'Trim whitespace'],
      ['sort', 'Sort lines'],
      ['unique', 'Remove duplicate lines'],
    ]);
  if (id === 'color') parameter('Comparison background', 'background', '#ffffff');
  if (id === 'regex') {
    parameter('Pattern', 'pattern', '[\\w.+-]+@[\\w.-]+\\.[a-z]{2,}');
    parameter('Flags', 'flags', 'gi');
    parameter('Replacement', 'replacement', '[email]');
    choice('Action', 'action', [
      ['match', 'Find matches'],
      ['replace', 'Replace matches'],
    ]);
  }
  const file = input('Local file', '', 'file');
  const fileField = field('Local file · up to 25 MiB', file);
  fileField.classList.add('tools-file-field');
  fileField.hidden = !['encrypt', 'hash', 'base64'].includes(id);
  if (id === 'base64')
    controls.get('action')!.addEventListener('change', () => {
      fileField.hidden = options.action !== 'encode';
      file.value = '';
    });
  file.addEventListener('change', () => {
    invalidate();
    if (
      file.files?.[0] &&
      file.files[0].size > toolLimits.fileBytes + (id === 'encrypt' ? 4096 : 0)
    ) {
      file.value = '';
      setUiText(state, 'Files support up to 25 MiB.');
    }
  });
  const password = input('Password', '', 'password'),
    confirm = input('Confirm password', '', 'password');
  password.autocomplete = 'new-password';
  confirm.autocomplete = 'new-password';
  const confirmation = field('Confirm password', confirm),
    security = element('div', 'tools-control-row tools-security');
  if (id === 'encrypt') {
    const action = choice('Operation', 'action', [
      ['encrypt', 'Encrypt'],
      ['decrypt', 'Decrypt'],
    ]);
    const mode = choice('Content', 'mode', [
      ['text', 'Text'],
      ['file', 'File'],
    ]);
    const reveal = input('Show password', '', 'checkbox'),
      revealLabel = element('label', 'tools-remember');
    revealLabel.append(reveal, element('span', '', 'Show password'));
    reveal.addEventListener('change', () => {
      password.type = confirm.type = reveal.checked ? 'text' : 'password';
    });
    security.append(field('Password', password), confirmation, revealLabel);
    const sync = () => {
      confirmation.hidden = action.value !== 'encrypt';
      fileField.hidden = mode.value !== 'file';
      file.value = '';
    };
    action.addEventListener('change', sync);
    mode.addEventListener('change', sync);
    sync();
  }
  const panes = element('div', 'tools-panes'),
    sourcePane = element('section', 'tools-pane'),
    outputPane = element('section', 'tools-pane');
  sourcePane.append(element('h3', 'tools-pane-heading', id === 'uuid' ? 'Count' : 'Input'));
  const sourceMount = element('div', 'tools-editor');
  sourcePane.append(sourceMount);
  const outputHeading = element('div', 'tools-pane-heading');
  outputHeading.append(element('h3', '', 'Output'));
  let result: ToolResult | undefined,
    sourceEditor: ToolEditor | undefined,
    outputEditor: ToolEditor | undefined;
  let diff: Awaited<ReturnType<(typeof import('./diff.js'))['createToolDiff']>> | undefined;
  const copy = button(
    'Copy',
    () => {
      if (result) void copyText(result.text, state);
    },
    'Copy',
    'text-link',
  );
  const exportResult = button(
    'Download',
    () => {
      if (!result) return;
      const name =
        result.filename ||
        (id === 'csv' && options.action === 'to-csv'
          ? 'converted.csv'
          : id === 'yaml' && options.action === 'to-yaml'
            ? 'converted.yaml'
            : 'glass-output.txt');
      download(
        new Blob([result.bytes || result.text], {
          type: result.mime || 'text/plain;charset=utf-8',
        }),
        name,
      );
    },
    'Download',
    'text-link',
  );
  copy.disabled = exportResult.disabled = true;
  outputHeading.append(copy, exportResult);
  outputPane.append(outputHeading);
  const outputMount = element('div', 'tools-editor tools-output');
  outputPane.append(outputMount);
  const swatch = element('div', 'tools-color-swatch');
  swatch.append(element('span', '', 'Aa'), element('span', '', 'Color & contrast'));
  swatch.hidden = id !== 'color';
  outputPane.append(swatch);
  panes.append(sourcePane, outputPane);
  if (id === 'encrypt') {
    const content = controls.get('mode')!;
    const sync = () => {
      sourcePane.hidden = content.value === 'file';
    };
    content.addEventListener('change', sync);
    sync();
    security.append(
      element(
        'p',
        'help tools-crypto-note',
        'Keep your password. Encrypted content cannot be recovered without it.',
      ),
    );
  }
  const actions = element('div', 'tools-action-row');
  const clear = () => {
    sequence++;
    worker.cancel();
    result = undefined;
    sourceEditor?.set('');
    outputEditor?.set('');
    file.value = '';
    password.value = confirm.value = '';
    copy.disabled = exportResult.disabled = true;
    state.removeAttribute('data-error');
    setUiText(state, 'Cleared.');
    run.disabled = false;
    cancel.hidden = true;
    host.setAttribute('aria-busy', 'false');
  };
  const run = button(
    'Run tool',
    () => {
      void execute();
    },
    'Play',
  );
  run.className = 'button';
  run.dataset.toolRun = '';
  run.disabled = true;
  const cancel = button(
    'Cancel',
    () => {
      sequence++;
      worker.cancel();
      run.disabled = false;
      cancel.hidden = true;
      host.setAttribute('aria-busy', 'false');
      setUiText(state, 'Operation cancelled.');
    },
    'X',
  );
  cancel.hidden = true;
  actions.append(
    run,
    cancel,
    button('Load example', () => sourceEditor?.set(tool.sample), 'RotateCcw'),
    button('Clear', clear, 'X', 'text-link'),
    draftControl,
    draftStatus,
  );
  if (id === 'time')
    actions.insertBefore(
      button('Use current time', () => sourceEditor?.set(new Date().toISOString()), 'RotateCcw'),
      actions.children[2],
    );
  if (id === 'jwt') {
    const note = element(
      'p',
      'tools-warning',
      'Decoded claims are unverified. This tool does not check the signature or authenticate the token.',
    );
    note.setAttribute('role', 'note');
    outputPane.prepend(note);
  }
  host.replaceChildren(heading, toolbar, security, fileField, panes, actions, state);
  let draft;
  try {
    if (canSaveToolDraft(id)) draft = await readToolDraft(id);
  } catch (error) {
    setUiText(draftStatus, errorText(error));
  }
  const restored = memory || draft;
  if (restored) {
    remember.checked = memory ? memory.remember : true;
    for (const [key, value] of Object.entries(restored.options)) {
      if (controls.has(key)) {
        controls.get(key)!.value = value;
        options[key] = value;
      }
    }
  }
  if (draft && !memory) {
    setUiText(draftStatus, 'Draft restored from this device.');
  }
  if (id === 'diff') {
    const { createToolDiff } = await import('./diff.js');
    const mount = element('div', 'tools-diff');
    panes.replaceWith(mount);
    diff = createToolDiff(
      mount,
      restored?.source ?? tool.sample,
      restored?.options.after ?? tool.sample.replace('quiet', 'thoughtful'),
      () => save(),
    );
    run.hidden = true;
    copy.hidden = exportResult.hidden = true;
    actions.querySelectorAll('button').forEach((node) => {
      if (node !== run && node !== cancel) node.hidden = true;
    });
    actions.prepend(
      button('Previous change', () => diff?.navigate(false), 'ChevronLeft'),
      button('Next change', () => diff?.navigate(true), 'ChevronRight'),
    );
    const source = element('details', 'tools-diff-accessible');
    source.append(element('summary', '', 'Accessible comparison'));
    const before = element('pre'),
      after = element('pre');
    source.append(
      element('h3', '', 'Original text'),
      before,
      element('h3', '', 'Changed text'),
      after,
    );
    source.addEventListener('toggle', () => {
      if (source.open) {
        before.textContent = diff!.value('before');
        after.textContent = diff!.value('after');
      }
    });
    mount.after(source);
  } else {
    sourceEditor = createToolEditor(
      sourceMount,
      restored?.source ?? tool.sample,
      () => {
        invalidate();
        save();
      },
      { label: id === 'uuid' ? 'Count' : 'Tool input', language: tool.language },
    );
    outputEditor = createToolEditor(outputMount, '', () => {}, {
      label: 'Tool output',
      readonly: true,
      language: ['json', 'yaml', 'csv', 'jwt', 'regex', 'color', 'time', 'number'].includes(id)
        ? 'json'
        : 'text',
    });
  }
  run.disabled = false;
  host.setAttribute('aria-busy', 'false');
  remember.addEventListener('change', () => {
    if (remember.checked) save();
    else {
      clearTimeout(saveTimer);
      void deleteToolDraft(id)
        .then(() => setUiText(draftStatus, 'Saved draft removed.'))
        .catch((error) => setUiText(draftStatus, errorText(error)));
    }
  });
  const forget = () => {
    clearTimeout(saveTimer);
    remember.checked = false;
    setUiText(draftStatus, 'Saved draft removed.');
  };
  addEventListener('glass:tools-clear-drafts', forget);
  const keydown = (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !run.disabled) {
      event.preventDefault();
      void execute();
    }
  };
  host.addEventListener('keydown', keydown);
  function invalidate() {
    result = undefined;
    copy.disabled = exportResult.disabled = true;
    if (run.disabled) {
      sequence++;
      worker.cancel();
      run.disabled = false;
      cancel.hidden = true;
      host.setAttribute('aria-busy', 'false');
    }
    if (state.dataset.ui) {
      state.removeAttribute('data-error');
      setUiText(state, 'Run the tool to update output.');
    }
  }
  async function execute() {
    const current = ++sequence;
    run.disabled = true;
    cancel.hidden = false;
    copy.disabled = exportResult.disabled = true;
    result = undefined;
    state.removeAttribute('data-error');
    setUiText(state, id === 'encrypt' ? 'Preparing encryption…' : 'Working…');
    host.setAttribute('aria-busy', 'true');
    try {
      let request: WorkerInput;
      if (id === 'encrypt') {
        if (options.action === 'encrypt' && password.value !== confirm.value)
          throw new Error('The passwords do not match.');
        let bytes: Uint8Array<ArrayBuffer>;
        const selected = file.files?.[0];
        if (options.mode === 'file') {
          if (!selected) throw new Error('Choose a local file.');
          bytes = new Uint8Array(await selected.arrayBuffer());
        } else if (options.action === 'decrypt') {
          const source = sourceEditor!.value().trim();
          if (!source.startsWith(encryptedTextPrefix))
            throw new Error('Paste a glassenc:v1 encrypted message.');
          bytes = base64Decode(source.slice(encryptedTextPrefix.length), true);
        } else bytes = new TextEncoder().encode(sourceEditor!.value());
        if (current !== sequence || disposed) return;
        setUiText(
          state,
          options.action === 'decrypt'
            ? 'Deriving key and decrypting…'
            : 'Deriving key and encrypting…',
        );
        request = {
          kind: options.action === 'decrypt' ? 'decrypt' : 'encrypt',
          bytes: bytes.buffer,
          password: password.value,
          metadata: {
            kind: options.mode === 'file' ? 'file' : 'text',
            name: selected?.name || 'message.txt',
            mime: selected?.type || 'text/plain',
          },
        };
      } else if (file.files?.[0] && ['hash', 'base64'].includes(id))
        request = {
          kind: id === 'hash' ? 'hash-file' : 'base64-file',
          bytes: await file.files[0].arrayBuffer(),
          algorithm: options.algorithm,
          urlSafe: options.urlSafe === 'true',
        };
      else
        request = {
          kind: 'tool',
          tool: id,
          source: sourceEditor!.value(),
          options: { ...options },
        };
      if (current !== sequence || disposed) return;
      result = await worker.run(
        request,
        id === 'regex' ? toolLimits.regexMs : id === 'encrypt' ? 30_000 : 10_000,
        'bytes' in request ? [request.bytes] : [],
      );
      if (current !== sequence || disposed) return;
      outputEditor!.set(result.text.length > 100_000 ? result.text.slice(0, 100_000) : result.text);
      copy.disabled =
        !result.text || result.text.length > toolLimits.textBytes * (id === 'encrypt' ? 2 : 1);
      exportResult.disabled = false;
      setUiText(
        state,
        result.bytes
          ? 'Ready to download.'
          : result.text.length > 100_000
            ? 'Showing the first 100,000 characters. Download the complete output.'
            : 'Done.',
      );
      if (id === 'color') {
        const color = JSON.parse(result.text);
        swatch.style.color = color.RGB;
        swatch.style.backgroundColor = options.background;
      }
    } catch (error) {
      if (current === sequence && !disposed) {
        outputEditor?.set('');
        setUiText(state, errorText(error));
        state.dataset.error = 'true';
      }
    } finally {
      if (current === sequence && !disposed) {
        run.disabled = false;
        cancel.hidden = true;
        host.setAttribute('aria-busy', 'false');
        password.value = confirm.value = '';
      }
    }
  }
  const snapshot = (): ToolMemory => ({
    source: diff?.value('before') ?? sourceEditor?.value() ?? '',
    options: { ...options, ...(diff ? { after: diff.value('after') } : {}) },
    remember: remember.checked,
  });
  return {
    snapshot,
    destroy() {
      if (remember.checked && canSaveToolDraft(id)) {
        const value = snapshot();
        void writeToolDraft({
          id,
          source: value.source,
          options: value.options,
          updated: Date.now(),
        }).catch(() => {});
      }
      disposed = true;
      sequence++;
      clearTimeout(saveTimer);
      worker.destroy();
      sourceEditor?.destroy();
      outputEditor?.destroy();
      diff?.destroy();
      password.value = confirm.value = '';
      file.value = '';
      result = undefined;
      host.removeEventListener('keydown', keydown);
      removeEventListener('glass:tools-clear-drafts', forget);
    },
  };
}
