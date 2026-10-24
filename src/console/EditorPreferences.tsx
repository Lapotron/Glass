import { t } from '../shared/i18n.js';
import { UiText } from '../shared/UiText.js';
import { componentLabels, type ComponentPreviewKind } from '../shared/source-components.js';
import { useId, useState } from 'react';
import { Button, Icon } from '../shared/ui.js';
import { markdownCatalog } from '../shared/markdown-catalog.js';
import { Field, ToggleField } from './components.js';
import { sourceDefaults, type SourcePreferences } from './source-analysis.js';
import {
  completionShortcutError,
  completionShortcutLabel,
  defaultCompletionShortcut,
  recordCompletionShortcut,
} from './source-shortcuts.js';
export type EditorAction = 'document' | 'selection' | 'preview' | 'fix' | 'complete';
export function EditorPreferences({
  value,
  onChange,
  temporary,
  busy,
  onAction,
  onExample,
}: {
  value: SourcePreferences;
  onChange: (patch: Partial<SourcePreferences>) => void;
  temporary: boolean;
  busy: boolean;
  onAction: (action: EditorAction) => void;
  onExample: (example: string) => void;
}) {
  const id = useId(),
    [query, setQuery] = useState('');
  const [recording, setRecording] = useState(false),
    [shortcutError, setShortcutError] = useState('');
  const sections = [
    'Writing',
    'Formatting',
    'Images',
    'Math',
    'Completion',
    'Previews',
    'Reference',
  ];
  const examples = markdownCatalog.filter((item) =>
    `${item.name} ${item.description} ${item.group}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div
      className="source-settings"
      onClick={(event) => {
        // Safari does not focus buttons on pointer activation; keep keyboard recovery inside Settings.
        (event.target as Element)
          .closest<HTMLButtonElement>('button')
          ?.focus({ preventScroll: true });
      }}
    >
      <header className="source-settings-head">
        <div>
          <h2>
            <Icon name="SlidersHorizontal" size={18} />
            <UiText message={'Editor settings'} />
          </h2>
          <p data-ui={'Private preferences and tools for this notebook.'}>
            {t('Private preferences and tools for this notebook.')}
          </p>
        </div>
        <Button className="small" icon="RotateCcw" onClick={() => onChange(sourceDefaults)}>
          <UiText message={'Reset preferences'} />
        </Button>
      </header>
      <nav
        className="source-settings-nav"
        aria-label={t('Editor settings sections')}
        data-ui-attrs={'{"aria-label":"Editor settings sections"}'}
      >
        {sections.map((name) => (
          <button
            type="button"
            key={name}
            onClick={() =>
              document.getElementById(`${id}-${name.toLowerCase()}`)?.scrollIntoView({
                block: 'start',
                behavior:
                  matchMedia('(prefers-reduced-motion: reduce)').matches ||
                  document.documentElement.dataset.reduceMotion === 'true'
                    ? 'instant'
                    : 'smooth',
              })
            }
          >
            {name}
          </button>
        ))}
      </nav>
      {temporary && (
        <p
          className="help"
          role="status"
          data-ui={'Browser storage is unavailable. These preferences last for this session.'}
        >
          {t('Browser storage is unavailable. These preferences last for this session.')}
        </p>
      )}
      <section id={`${id}-writing`} className="source-settings-group">
        <h3>
          <Icon name="PenLine" size={16} />
          <UiText message={'Writing surface'} />
        </h3>
        <div className="source-settings-toggles">
          {(
            [
              ['navigator', 'Document navigator'],
              ['minimap', 'Document minimap'],
              ['wrap', 'Wrap long lines'],
              ['numbers', 'Source line numbers'],
              ['whitespace', 'Show whitespace'],
              ['activeLine', 'Highlight active line'],
            ] as const
          ).map(([key, label]) => (
            <ToggleField
              key={key}
              label={label}
              help={
                key === 'navigator'
                  ? t(
                      'Outline, Problems, and Find results beside the source. This does not change the published article outline.',
                    )
                  : undefined
              }
              checked={value[key]}
              onChange={(checked) => onChange({ [key]: checked })}
            />
          ))}
        </div>
        <div className="source-settings-fields">
          <Field
            label={t('Source text scale · {value0}%', { value0: Math.round(value.scale * 100) })}
          >
            <input
              type="range"
              aria-label={t('Source text scale')}
              min="0.85"
              max="1.4"
              step="0.05"
              value={value.scale}
              onChange={(e) => onChange({ scale: Number(e.target.value) })}
              data-ui-attrs={'{"aria-label":"Source text scale"}'}
            />
          </Field>
          <Field label={t('Indentation')}>
            <select
              value={value.indent}
              onChange={(e) => onChange({ indent: Number(e.target.value) })}
            >
              <option value={2} data-ui={'2 spaces'}>
                {t('2 spaces')}
              </option>
              <option value={4} data-ui={'4 spaces'}>
                {t('4 spaces')}
              </option>
            </select>
          </Field>
        </div>
      </section>
      <section id={`${id}-formatting`} className="source-settings-group">
        <h3>
          <Icon name="Code2" size={16} />
          <UiText message={'Formatting & linting'} />
        </h3>
        <p
          className="help"
          data-ui={
            'Formatting keeps parsed meaning, math and code intact. Every change is undoable.'
          }
        >
          {t('Formatting keeps parsed meaning, math and code intact. Every change is undoable.')}
        </p>
        <ToggleField
          label={t('Format on explicit save')}
          help={t('Ctrl/Cmd S formats first. Ordinary autosave retains your spacing.')}
          checked={value.formatOnSave}
          onChange={(formatOnSave) => onChange({ formatOnSave })}
        />
        <div className="source-settings-actions">
          {(
            [
              ['document', 'Format document'],
              ['selection', 'Format selected blocks'],
              ['preview', 'Preview formatting'],
              ['fix', 'Fix safe issues'],
            ] as const
          ).map(([action, label]) => (
            <Button
              key={action}
              className="small"
              icon={action === 'preview' ? 'Eye' : action === 'fix' ? 'CheckCheck' : 'Code2'}
              disabled={busy}
              onClick={() => onAction(action)}
            >
              {label}
            </Button>
          ))}
        </div>
        <p
          className="help"
          data-ui={
            'Ctrl/Cmd Shift F formats the document. The command palette also has these tools.'
          }
        >
          {t('Ctrl/Cmd Shift F formats the document. The command palette also has these tools.')}
        </p>
      </section>
      <section id={`${id}-images`} className="source-settings-group">
        <h3>
          <Icon name="Image" size={16} />
          <UiText message={'Image previews'} />
        </h3>
        <Field
          label={t('Image previews')}
          help={t(
            'Canonical image syntax stays visible. External images load only after activation.',
          )}
        >
          <select
            value={value.imagePreviews}
            onChange={(e) =>
              onChange({ imagePreviews: e.target.value as SourcePreferences['imagePreviews'] })
            }
          >
            <option value="both" data-ui={'Thumbnails and hover previews'}>
              {t('Thumbnails and hover previews')}
            </option>
            <option value="thumbnails" data-ui={'Thumbnails only'}>
              {t('Thumbnails only')}
            </option>
            <option value="hover" data-ui={'Hover and focus only'}>
              {t('Hover and focus only')}
            </option>
            <option value="off" data-ui={'Off'}>
              {t('Off')}
            </option>
          </select>
        </Field>
      </section>
      <section id={`${id}-math`} className="source-settings-group">
        <h3>
          <Icon name="FunctionSquare" size={16} />
          <UiText message={'Math previews'} />
        </h3>
        <ToggleField
          label={t('Display math previews')}
          help={t(
            'Render MathJax 4 beneath display equations. Your TeX stays visible and editable.',
          )}
          checked={value.mathPreviews}
          onChange={(mathPreviews) => onChange({ mathPreviews })}
        />
        <ToggleField
          label={t('Inline math previews')}
          help={t(
            'Show rendered math right after inline $…$ source, while keeping the TeX editable.',
          )}
          checked={value.inlineMathPreviews}
          onChange={(inlineMathPreviews) => onChange({ inlineMathPreviews })}
        />
      </section>
      <section id={`${id}-completion`} className="source-settings-group">
        <h3>
          <Icon name="Sparkles" size={16} />
          <UiText message={'Source completion'} />
        </h3>
        <ToggleField
          label={t('Suggest while typing')}
          help={t('Contextual Markdown, math, components, local links and JSON fields.')}
          checked={value.completeOnTyping}
          onChange={(completeOnTyping) => onChange({ completeOnTyping })}
        />
        <ToggleField
          label={t('Close brackets automatically')}
          checked={value.closeBrackets}
          onChange={(closeBrackets) => onChange({ closeBrackets })}
        />
        <div className="source-settings-actions">
          <Button className="small" icon="Sparkles" onClick={() => onAction('complete')}>
            <UiText message={'Complete at cursor'} />
          </Button>
          <kbd>{completionShortcutLabel(value.completionShortcut)}</kbd>
        </div>
        <fieldset className="source-shortcut-field">
          <legend data-ui={'Completion shortcut'}>{t('Completion shortcut')}</legend>
          <p
            className="help"
            data-ui={
              'Record Ctrl, Cmd or Alt with a key. Existing editor shortcuts are reserved. Escape cancels.'
            }
          >
            {t(
              'Record Ctrl, Cmd or Alt with a key. Existing editor shortcuts are reserved. Escape cancels.',
            )}
          </p>
          <div className="source-shortcut-control">
            <button
              type="button"
              className="source-shortcut-recorder"
              aria-label={
                recording ? t('Record completion shortcut') : t('Change completion shortcut')
              }
              aria-pressed={recording}
              aria-describedby={`${id}-shortcut-status`}
              onClick={() => {
                setRecording((current) => !current);
                setShortcutError('');
              }}
              onBlur={() => setRecording(false)}
              onKeyDown={(event) => {
                if (!recording) return;
                event.stopPropagation();
                if (event.key === 'Tab') {
                  setRecording(false);
                  return;
                }
                event.preventDefault();
                if (event.key === 'Escape') {
                  setRecording(false);
                  setShortcutError('');
                  return;
                }
                if (event.nativeEvent.getModifierState('AltGraph')) {
                  setShortcutError('AltGr is used for typing. Choose Ctrl, Cmd or Alt instead.');
                  return;
                }
                const chord = recordCompletionShortcut(
                  event.nativeEvent,
                  /Mac|iPhone|iPad/.test(navigator.platform),
                );
                if (chord === undefined) return;
                const error = completionShortcutError(chord);
                if (error) {
                  setShortcutError(error);
                  return;
                }
                onChange({ completionShortcut: chord });
                setShortcutError('');
                setRecording(false);
              }}
            >
              <Icon name="Code2" size={16} />
              <span>
                {recording
                  ? t('Press your shortcut…')
                  : completionShortcutLabel(value.completionShortcut)}
              </span>
              <Icon name="PenLine" size={13} />
            </button>
            <Button
              className="small"
              icon="RotateCcw"
              disabled={value.completionShortcut === defaultCompletionShortcut && !recording}
              aria-label={t('Reset completion shortcut')}
              onClick={() => {
                onChange({ completionShortcut: defaultCompletionShortcut });
                setRecording(false);
                setShortcutError('');
              }}
            >
              <UiText message={'Reset'} />
            </Button>
            <Button
              className="small"
              disabled={!value.completionShortcut}
              aria-label={t('Disable completion shortcut')}
              onClick={() => {
                onChange({ completionShortcut: '' });
                setRecording(false);
                setShortcutError('');
              }}
            >
              <UiText message={'Unassign'} />
            </Button>
          </div>
        </fieldset>
        <p
          className={shortcutError ? 'error-message' : 'help'}
          role="status"
          id={`${id}-shortcut-status`}
        >
          {shortcutError ||
            (recording
              ? 'Listening for a shortcut. Tab leaves this control; Escape cancels.'
              : 'Applies immediately to this notebook in this browser. Completion remains available in the command palette.')}
        </p>
      </section>
      <section id={`${id}-previews`} className="source-settings-group">
        <h3>
          <Icon name="Layers" size={16} /> <UiText message={' Component previews'} />
        </h3>
        <p
          className="help"
          data-ui={
            'Rendered previews follow source blocks. Their tools edit Markdown through one undoable change.'
          }
        >
          {t(
            'Rendered previews follow source blocks. Their tools edit Markdown through one undoable change.',
          )}
        </p>
        {(Object.entries(componentLabels) as [ComponentPreviewKind, string][])
          .filter(([kind]) => kind !== 'pseudocode')
          .map(([kind, label]) => (
            <ToggleField
              key={kind}
              label={t('{value0} previews', { value0: label })}
              checked={value.componentPreviews[kind]}
              onChange={(enabled) =>
                onChange({ componentPreviews: { ...value.componentPreviews, [kind]: enabled } })
              }
            />
          ))}
      </section>
      <section id={`${id}-reference`} className="source-settings-group">
        <h3>
          <Icon name="BookOpen" size={16} />
          <UiText message={'Markdown reference'} />
        </h3>
        <p
          className="help"
          data-ui={'Supported components come from the same catalog as validation and completion.'}
        >
          {t('Supported components come from the same catalog as validation and completion.')}
        </p>
        <label className="search-field">
          <Icon name="Search" size={15} />
          <input
            type="search"
            aria-label={t('Search Markdown reference')}
            placeholder={t('Search components and syntax…')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            data-ui-attrs={
              '{"aria-label":"Search Markdown reference","placeholder":"Search components and syntax…"}'
            }
          />
        </label>
        <div className="source-reference-list">
          {examples.map((item) => (
            <details key={item.name}>
              <summary>
                <code>{item.name}</code>
                <span>{item.group}</span>
              </summary>
              <p>{item.description}</p>
              <pre tabIndex={0}>
                <code>{item.example}</code>
              </pre>
              <Button className="small" icon="Plus" onClick={() => onExample(item.example)}>
                <UiText message={'Insert example'} />
              </Button>
            </details>
          ))}
          {!examples.length && (
            <p className="help" data-ui={'No matching syntax. Try another component name.'}>
              {t('No matching syntax. Try another component name.')}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
