import {
  autocompletion,
  snippet,
  type CompletionSource,
  type Completion,
} from '@codemirror/autocomplete';
import { hoverTooltip } from '@codemirror/view';
import {
  mathCommandCatalog,
  mathCommandSource,
  mathEnvironments,
  mathExtensions,
  stemPackages,
  type MathExtension,
  type MathCommand,
} from '../../shared/math-catalog.js';
import { mathMacros } from '../../shared/math-symbols.js';
import { toolLimits } from '../../shared/tools-catalog.js';
import { setUiText, t } from '../../shared/i18n.js';
import { createToolEditor } from './editor.js';
import { element, button, field, input, select, copyText, download, errorText } from './dom.js';
import { ToolWorker } from './worker-client.js';
import { readToolDraft, writeToolDraft, deleteToolDraft } from './storage.js';
import type { MathRequest, MathResult } from './math.worker.js';
const defaultSource = '\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}';
const preferenceKey = 'glass-tools-equation-preferences-v1';
export function bareLatex(source: string) {
  const value = source.trim();
  for (const [left, right] of [
    ['$$', '$$'],
    ['\\[', '\\]'],
    ['\\(', '\\)'],
    ['$', '$'],
  ])
    if (
      value.startsWith(left) &&
      value.endsWith(right) &&
      value.length >= left.length + right.length
    )
      return value.slice(left.length, -right.length).trim();
  return value;
}
/** Treat compiler drawings as SVG data, never as arbitrary HTML. */
export function drawing(source: string): SVGSVGElement {
  const document = new DOMParser().parseFromString(source, 'image/svg+xml');
  if (
    document.querySelector('parsererror,script,foreignObject,image,style') ||
    document.documentElement.localName !== 'svg'
  )
    throw new Error('This equation could not be rendered.');
  for (const node of document.querySelectorAll('*'))
    for (const attribute of node.attributes)
      if (
        /^on/i.test(attribute.name) ||
        (/(?:href|src)$/i.test(attribute.name) && !attribute.value.startsWith('#')) ||
        /url\(\s*["']?(?!#)/i.test(attribute.value)
      )
        throw new Error('This equation could not be rendered.');
  return document.documentElement as unknown as SVGSVGElement;
}
function completionSnippet(command: MathCommand) {
  return '\\' + command.name + (command.arguments || []).map((arg) => '{${' + arg + '}}').join('');
}
export async function openEquationEditor(host: HTMLElement) {
  const createWorker = () =>
    new Worker(new URL('./math.worker.ts', import.meta.url), { type: 'module' });
  const worker = new ToolWorker<MathRequest, MathResult>(createWorker),
    examples = new ToolWorker<MathRequest, MathResult>(createWorker);
  let packages: MathExtension[] = [...stemPackages],
    display = true,
    disposed = false,
    ratio = 50;
  try {
    const preferences = JSON.parse(localStorage.getItem(preferenceKey) || '{}');
    if (Array.isArray(preferences.packages))
      packages = preferences.packages.filter((p: MathExtension) => mathExtensions.includes(p));
    if (typeof preferences.display === 'boolean') display = preferences.display;
    if (Number.isFinite(preferences.ratio)) ratio = Math.max(25, Math.min(75, preferences.ratio));
  } catch {
    /* Preferences are optional. */
  }
  const savePreferences = () => {
    try {
      localStorage.setItem(preferenceKey, JSON.stringify({ packages, display, ratio }));
    } catch {
      /* Preferences are optional. */
    }
  };
  const heading = element('header', 'tools-workspace-heading'),
    headingText = element('div');
  headingText.append(
    element('span', 'eyebrow', 'Write beautifully'),
    element('h2', '', 'Equation editor'),
    element(
      'p',
      'help',
      'LaTeX intelligence, live MathJax 4 rendering and publication-ready exports.',
    ),
  );
  heading.append(headingText);
  const toolbar = element('div', 'tools-control-row'),
    mode = select(
      'Math layout',
      [
        ['display', 'Display math'],
        ['inline', 'Inline math'],
      ],
      () => {
        display = mode.value === 'display';
        savePreferences();
        schedule();
      },
    );
  mode.value = display ? 'display' : 'inline';
  toolbar.append(field('Math layout', mode));
  const loadExample = select('Equation examples', [
    ['gaussian', 'Gaussian integral'],
    ['matrix', 'Matrix'],
    ['aligned', 'Aligned equations'],
    ['physics', 'Physics'],
    ['chemistry', 'Chemistry'],
  ]);
  toolbar.append(
    field('Equation examples', loadExample),
    button(
      'Insert example',
      () => {
        const sample = {
          gaussian: defaultSource,
          matrix: '\\begin{pmatrix}a & b \\\\ c & d\\end{pmatrix}',
          aligned: '\\begin{aligned}E &= mc^2 \\\\ F &= ma\\end{aligned}',
          physics: '\\dv[2]{x}{t} = -\\omega^2 x',
          chemistry: '\\ce{2H2 + O2 -> 2H2O}',
        }[loadExample.value];
        if (loadExample.value === 'physics' && !packages.includes('physics')) {
          packages.push('physics');
          packageInputs.get('physics')!.checked = true;
          savePreferences();
        }
        if (loadExample.value === 'chemistry' && !packages.includes('mhchem')) {
          packages.push('mhchem');
          packageInputs.get('mhchem')!.checked = true;
          savePreferences();
        }
        editor.set(sample || defaultSource);
      },
      'Plus',
    ),
  );
  const packagesDisclosure = element('details', 'tools-math-packages');
  packagesDisclosure.append(element('summary', '', 'Math packages'));
  const packageGrid = element('div', 'tools-package-grid'),
    packageInputs = new Map<MathExtension, HTMLInputElement>();
  for (const name of mathExtensions) {
    const node = input(name, '', 'checkbox');
    node.checked = packages.includes(name);
    packageInputs.set(name, node);
    const label = element('label', 'tools-remember');
    const code = element('code');
    code.textContent = name;
    label.append(node, code);
    packageGrid.append(label);
    node.addEventListener('change', () => {
      packages = mathExtensions.filter((name) => packageInputs.get(name)!.checked);
      savePreferences();
      schedule();
    });
  }
  packagesDisclosure.append(
    element(
      'p',
      'help',
      'Core TeX, AMS and local macros are always available. Physics is opt-in because it changes some command meanings.',
    ),
    packageGrid,
  );
  const panes = element('div', 'tools-equation-panes');
  panes.style.setProperty('--tools-split', ratio + '%');
  const sourcePane = element('section', 'tools-pane'),
    previewPane = element('section', 'tools-pane');
  sourcePane.append(element('h3', 'tools-pane-heading', 'LaTeX source'));
  const sourceMount = element('div', 'tools-editor tools-math-source');
  sourcePane.append(sourceMount);
  const separator = element('div', 'tools-separator');
  separator.tabIndex = 0;
  separator.setAttribute('role', 'separator');
  separator.setAttribute('aria-orientation', 'vertical');
  separator.setAttribute('aria-label', t('Resize equation panes'));
  separator.setAttribute('aria-valuemin', '25');
  separator.setAttribute('aria-valuemax', '75');
  const setRatio = (value: number) => {
    ratio = Math.max(25, Math.min(75, value));
    panes.style.setProperty('--tools-split', ratio + '%');
    separator.setAttribute('aria-valuenow', String(Math.round(ratio)));
    savePreferences();
  };
  setRatio(ratio);
  separator.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    separator.setPointerCapture(event.pointerId);
  });
  separator.addEventListener('pointermove', (event) => {
    if (separator.hasPointerCapture(event.pointerId)) {
      const bounds = panes.getBoundingClientRect();
      setRatio(((event.clientX - bounds.left) / bounds.width) * 100);
    }
  });
  separator.addEventListener('pointerup', (event) => {
    if (separator.hasPointerCapture(event.pointerId))
      separator.releasePointerCapture(event.pointerId);
  });
  separator.addEventListener('keydown', (event) => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      setRatio(
        event.key === 'Home'
          ? 25
          : event.key === 'End'
            ? 75
            : ratio + (event.key === 'ArrowLeft' ? -2 : 2),
      );
    }
  });
  const previewHeading = element('div', 'tools-pane-heading');
  previewHeading.append(element('h3', '', 'Live preview'));
  const preview = element('div', 'tools-math-preview');
  preview.setAttribute('role', 'math');
  preview.tabIndex = 0;
  const state = element('p', 'tools-status');
  state.setAttribute('role', 'status');
  previewPane.append(previewHeading, preview);
  panes.append(sourcePane, separator, previewPane);
  const palette = element('details', 'tools-symbols');
  palette.append(element('summary', '', 'Symbols & templates'));
  const symbolSearch = input('Find a symbol or command'),
    symbolGrid = element('div', 'tools-symbol-grid');
  palette.append(field('Find a symbol or command', symbolSearch), symbolGrid);
  const showSymbols = () => {
    const query = symbolSearch.value.toLowerCase();
    symbolGrid.replaceChildren();
    for (const command of mathCommandCatalog
      .filter(
        (command) =>
          (!command.package || packages.includes(command.package)) &&
          `${command.name} ${command.description} ${command.aliases || ''}`
            .toLowerCase()
            .includes(query),
      )
      .slice(0, 60)) {
      const node = button(
        command.symbol || '\\' + command.name,
        () => editor.insert(mathCommandSource(command)),
        undefined,
        'tools-symbol',
      );
      node.title = command.description;
      node.setAttribute('aria-label', '\\' + command.name + ' · ' + command.description);
      symbolGrid.append(node);
    }
  };
  symbolSearch.addEventListener('input', showSymbols);
  palette.addEventListener('toggle', () => {
    if (palette.open) showSymbols();
  });
  const exports = element('section', 'tools-exports'),
    exportControls = element('div', 'tools-control-row');
  const color = input('Export text color', '#000000', 'color'),
    background = input('Export background', '#ffffff', 'color'),
    transparent = input('Transparent background', '', 'checkbox');
  transparent.checked = true;
  const transparentLabel = element('label', 'tools-remember');
  transparentLabel.append(transparent, element('span', '', 'Transparent background'));
  const fontSize = input('Font size', '24', 'number');
  fontSize.min = '12';
  fontSize.max = '96';
  const padding = input('Padding', '16', 'number');
  padding.min = '0';
  padding.max = '128';
  const scale = select('PNG scale', [
    ['1', '1×'],
    ['2', '2×'],
    ['3', '3×'],
    ['4', '4×'],
  ]);
  scale.value = '2';
  exportControls.append(
    field('Text color', color),
    field('Background', background),
    transparentLabel,
    field('Font size', fontSize),
    field('Padding', padding),
    field('PNG scale', scale),
  );
  const exportActions = element('div', 'tools-action-row');
  let last: MathResult | undefined,
    dirty = false,
    busy = false,
    version = 0,
    warmed = false,
    saveTimer: ReturnType<typeof setTimeout> | undefined;
  const cache = new Map<string, MathResult>(),
    exampleCache = new Map<string, string>();
  const readyButtons: HTMLButtonElement[] = [];
  const exportSvg = () => {
    if (!last) throw new Error('Wait for a valid preview before exporting.');
    const node = drawing(last.svg),
      box = node.getAttribute('viewBox')!.split(/\s+/).map(Number);
    const size = Number(fontSize.value),
      pad = Number(padding.value);
    if (
      !Number.isFinite(size) ||
      size < 12 ||
      size > 96 ||
      !Number.isFinite(pad) ||
      pad < 0 ||
      pad > 128 ||
      box.length !== 4 ||
      box.some((n) => !Number.isFinite(n))
    )
      throw new Error('Check the export size and padding.');
    const offset = (pad / size) * 1000,
      width = (box[2] / 1000) * size + pad * 2,
      height = (box[3] / 1000) * size + pad * 2;
    if (width * Number(scale.value) > 4096 || height * Number(scale.value) > 4096)
      throw new Error('Export dimensions support up to 4,096 pixels.');
    node.setAttribute(
      'viewBox',
      [box[0] - offset, box[1] - offset, box[2] + offset * 2, box[3] + offset * 2].join(' '),
    );
    node.setAttribute('width', String(Math.ceil(width)));
    node.setAttribute('height', String(Math.ceil(height)));
    node.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    node.style.color = color.value;
    node.style.background = 'transparent';
    node.style.verticalAlign = '';
    if (!transparent.checked) {
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', String(box[0] - offset));
      rect.setAttribute('y', String(box[1] - offset));
      rect.setAttribute('width', String(box[2] + offset * 2));
      rect.setAttribute('height', String(box[3] + offset * 2));
      rect.setAttribute('fill', background.value);
      node.prepend(rect);
    }
    return {
      source: new XMLSerializer().serializeToString(node),
      width: Math.ceil(width),
      height: Math.ceil(height),
    };
  };
  const svgButton = button(
    'Download SVG',
    () => {
      try {
        download(new Blob([exportSvg().source], { type: 'image/svg+xml' }), 'equation.svg');
      } catch (error) {
        setUiText(state, errorText(error));
      }
    },
    'Download',
  );
  const pngButton = button(
    'Download PNG',
    () => {
      void (async () => {
        let url: string | undefined;
        try {
          const svg = exportSvg(),
            image = new Image();
          url = URL.createObjectURL(new Blob([svg.source], { type: 'image/svg+xml' }));
          image.src = url;
          await image.decode();
          const canvas = document.createElement('canvas'),
            multiplier = Number(scale.value);
          canvas.width = svg.width * multiplier;
          canvas.height = svg.height * multiplier;
          const context = canvas.getContext('2d');
          if (!context) throw new Error('Image export is unavailable.');
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          const blob = await new Promise<Blob>((resolve, reject) =>
            canvas.toBlob(
              (blob) => (blob ? resolve(blob) : reject(new Error('Image export is unavailable.'))),
              'image/png',
            ),
          );
          download(blob, 'equation.png');
        } catch (error) {
          setUiText(state, errorText(error));
        } finally {
          if (url) URL.revokeObjectURL(url);
        }
      })();
    },
    'Download',
  );
  const mathmlButton = button(
    'Copy MathML',
    () => {
      if (last) void copyText(last.mathml, state);
    },
    'Copy',
    'text-link',
  );
  readyButtons.push(svgButton, pngButton, mathmlButton);
  readyButtons.forEach((button) => (button.disabled = true));
  exportActions.append(
    button(
      'Copy LaTeX',
      () => {
        void copyText(bareLatex(editor.value()), state);
      },
      'Copy',
      'text-link',
    ),
    button(
      'Copy Markdown',
      () => {
        const source = bareLatex(editor.value());
        void copyText(display ? '$$\n' + source + '\n$$' : '$' + source + '$', state);
      },
      'Copy',
      'text-link',
    ),
    mathmlButton,
    svgButton,
    pngButton,
  );
  exports.append(element('h3', '', 'Export equation'), exportControls, exportActions);
  const remember = input('Remember this draft', '', 'checkbox'),
    rememberLabel = element('label', 'tools-remember'),
    draftStatus = element('span', 'help');
  rememberLabel.append(remember, element('span', '', 'Remember this draft'));
  const foot = element('div', 'tools-action-row');
  foot.append(
    rememberLabel,
    draftStatus,
    button('Clear', () => editor.set(''), 'X', 'text-link'),
  );
  host.replaceChildren(heading, toolbar, packagesDisclosure, panes, state, palette, exports, foot);
  let draft;
  try {
    draft = await readToolDraft('equation');
  } catch (error) {
    setUiText(draftStatus, errorText(error));
  }
  if (draft) {
    remember.checked = true;
    setUiText(draftStatus, 'Draft restored from this device.');
  }
  const renderExample = async (source: string) => {
    const key = packages.join(',') + source;
    if (exampleCache.has(key)) return exampleCache.get(key)!;
    const result = await examples.run({ source, display: false, packages }, toolLimits.mathMs);
    if (exampleCache.size > 40) exampleCache.delete(exampleCache.keys().next().value!);
    exampleCache.set(key, result.svg);
    return result.svg;
  };
  const info = (command: MathCommand) => {
    const node = element('div', 'tools-math-completion'),
      caption = element('p');
    caption.textContent = command.description;
    const example = element('div');
    node.append(caption, example);
    void renderExample(mathCommandSource(command))
      .then((svg) => {
        if (!disposed) example.replaceChildren(document.importNode(drawing(svg), true));
      })
      .catch(() => {
        example.textContent = mathCommandSource(command);
      });
    return node;
  };
  const completion: CompletionSource = (context) => {
    const environment = context.matchBefore(/\\(?:begin|end)\{[A-Za-z*]*/);
    if (environment)
      return {
        from: environment.from + environment.text.indexOf('{') + 1,
        options: mathEnvironments.map((name) => ({
          label: name,
          type: 'keyword',
          apply: name + '}',
        })),
      };
    const token = context.matchBefore(/\\[A-Za-z]*/);
    if (!token || (!context.explicit && token.text.length < 1)) return null;
    const options: Completion[] = mathCommandCatalog
      .filter((command) => !command.package || packages.includes(command.package))
      .map((command) => ({
        label: '\\' + command.name,
        displayLabel: command.symbol
          ? '\\' + command.name + '   ' + command.symbol
          : '\\' + command.name,
        detail: command.description,
        type: 'function',
        apply: snippet(completionSnippet(command)),
        info: () => ({ dom: info(command) }),
      }));
    for (const macro of mathMacros(context.state.doc.toString()).filter(
      (macro) => macro.to < context.pos,
    ))
      options.unshift({
        label: '\\' + macro.name,
        detail: t('Local macro'),
        type: 'function',
        apply: snippet(
          '\\' +
            macro.name +
            Array.from(
              { length: macro.arguments - (macro.optional ? 1 : 0) },
              (_, i) => '{${arg' + (i + 1) + '}}',
            ).join(''),
        ),
      });
    return { from: token.from, options, validFor: /^\\[A-Za-z]*$/ };
  };
  const editor = createToolEditor(
    sourceMount,
    draft?.source ?? defaultSource,
    () => {
      schedule();
      saveDraft();
    },
    {
      label: 'LaTeX source',
      language: 'tex',
      extensions: [
        autocompletion({ override: [completion] }),
        hoverTooltip((view, position) => {
          const line = view.state.doc.lineAt(position),
            column = position - line.from;
          for (const match of line.text.matchAll(/\\[A-Za-z]+/g)) {
            if (column < match.index! || column > match.index! + match[0].length) continue;
            const command = mathCommandCatalog.find(
              (command) =>
                command.name === match[0].slice(1) &&
                (!command.package || packages.includes(command.package)),
            );
            if (command)
              return {
                pos: line.from + match.index!,
                end: line.from + match.index! + match[0].length,
                above: true,
                create: () => ({ dom: info(command) }),
              };
          }
          return null;
        }),
      ],
    },
  );
  function saveDraft() {
    clearTimeout(saveTimer);
    if (!remember.checked || disposed) return;
    saveTimer = setTimeout(() => {
      if (!remember.checked || disposed) return;
      void writeToolDraft({
        id: 'equation',
        source: editor.value(),
        options: {},
        updated: Date.now(),
      })
        .then(() => {
          if (!disposed) setUiText(draftStatus, 'Saved on this device.');
        })
        .catch((error) => setUiText(draftStatus, errorText(error)));
    }, 600);
  }
  function schedule() {
    if (disposed) return;
    version++;
    dirty = true;
    last = undefined;
    readyButtons.forEach((button) => (button.disabled = true));
    void renderLoop();
  }
  async function renderLoop() {
    if (busy || disposed) return;
    busy = true;
    while (dirty && !disposed) {
      dirty = false;
      const requestVersion = version,
        source = bareLatex(editor.value()),
        selected = [...packages],
        block = display;
      if (!source) {
        preview.replaceChildren(element('p', 'help', 'Write an equation to see its preview.'));
        state.textContent = '';
        continue;
      }
      setUiText(state, 'Rendering equation…');
      preview.setAttribute('aria-busy', 'true');
      try {
        if (new TextEncoder().encode(source).length > toolLimits.mathBytes)
          throw new Error('Equations support up to 32 KiB of LaTeX.');
        const key = JSON.stringify([source, selected, block]);
        const result =
          cache.get(key) ||
          (await worker.run(
            { source, display: block, packages: selected },
            warmed ? toolLimits.mathMs : 15_000,
          ));
        warmed = true;
        if (cache.size > 30) cache.delete(cache.keys().next().value!);
        cache.set(key, result);
        if (disposed || requestVersion !== version) continue;
        last = result;
        preview.replaceChildren(document.importNode(drawing(result.svg), true));
        preview.setAttribute('aria-label', source);
        state.removeAttribute('data-error');
        setUiText(state, 'Preview ready.');
        readyButtons.forEach((button) => (button.disabled = false));
      } catch (error) {
        if (!disposed && requestVersion === version) {
          last = undefined;
          preview.replaceChildren(element('p', 'help', 'Edit the equation to update its preview.'));
          state.dataset.error = 'true';
          setUiText(state, errorText(error));
        }
      } finally {
        if (!disposed && requestVersion === version) preview.setAttribute('aria-busy', 'false');
      }
    }
    busy = false;
  }
  remember.addEventListener('change', () => {
    if (remember.checked) saveDraft();
    else {
      clearTimeout(saveTimer);
      void deleteToolDraft('equation')
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
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      schedule();
    }
  };
  host.addEventListener('keydown', keydown);
  schedule();
  return {
    destroy() {
      disposed = true;
      clearTimeout(saveTimer);
      worker.destroy();
      examples.destroy();
      editor.destroy();
      host.removeEventListener('keydown', keydown);
      removeEventListener('glass:tools-clear-drafts', forget);
    },
  };
}
