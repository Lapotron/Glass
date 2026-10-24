import { Icon } from '../shared/ui.js';
import { UiText } from '../shared/UiText.js';
import { uiAttrs } from '../shared/i18n.js';
import { developerTools } from '../shared/tools-catalog.js';

export function ToolsPage() {
  return (
    <section className="tools-page" data-tools-page>
      <div hidden>
        {(
          [
            'Copy',
            'Download',
            'Pin',
            'Play',
            'RotateCcw',
            'Upload',
            'X',
            'Plus',
            'Trash2',
            'ChevronLeft',
            'ChevronRight',
          ] as const
        ).map((name) => (
          <template key={name} data-tools-icon={name}>
            <Icon name={name} size={14} />
          </template>
        ))}
      </div>
      <header className="tools-heading">
        <span className="eyebrow">
          <Icon name="Code2" size={15} />
          <UiText message="A little room to make things" />
        </span>
        <h1>
          <UiText message="Tools" />
        </h1>
        <p>
          <UiText message="Useful developer utilities and a thoughtful equation editor. Everything runs in your browser." />
        </p>
      </header>
      <div
        className="tools-tabs glass"
        role="tablist"
        {...uiAttrs({ 'aria-label': 'Tools workspace' })}
      >
        <button
          id="tools-tab-developer"
          type="button"
          role="tab"
          aria-selected="true"
          aria-controls="tools-developer"
          data-tools-tab="developer"
        >
          <Icon name="Code2" size={16} />
          <UiText message="Developer toolbox" />
        </button>
        <button
          id="tools-tab-equation"
          type="button"
          role="tab"
          aria-selected="false"
          aria-controls="tools-equation"
          tabIndex={-1}
          data-tools-tab="equation"
        >
          <Icon name="FunctionSquare" size={17} />
          <UiText message="Equation editor" />
        </button>
      </div>
      <p className="tools-no-js help" data-tools-no-js>
        <UiText message="JavaScript is needed to run these browser-local tools. You can browse the tool directory." />
      </p>
      <div
        className="tools-developer"
        id="tools-developer"
        role="tabpanel"
        aria-labelledby="tools-tab-developer"
      >
        <aside className="tools-directory glass-panel">
          <div className="tools-directory-scroll">
            <label className="tools-finder">
              <Icon name="Search" size={16} />
              <input
                type="search"
                data-tool-search
                {...uiAttrs({ 'aria-label': 'Find a tool', placeholder: 'Find a tool…' })}
              />
            </label>
            <div className="tools-filter-row">
              <button type="button" className="text-link" data-tool-favorites aria-pressed="false">
                <Icon name="Pin" size={13} />
                <UiText message="Favorites" />
              </button>
              <span data-tool-count>{developerTools.length}</span>
            </div>
            <nav {...uiAttrs({ 'aria-label': 'Developer tools' })}>
              {developerTools.map((tool) => (
                <a
                  key={tool.id}
                  href={`#developer/${tool.id}`}
                  data-tool-id={tool.id}
                  data-tool-group={tool.group}
                >
                  <span className="tools-directory-label">
                    <UiText message={tool.label} />
                  </span>
                  <span className="tools-directory-description">
                    <UiText message={tool.description} />
                  </span>
                </a>
              ))}
            </nav>
            <p className="help" hidden data-tools-empty>
              <UiText message="No tools match your search." />
            </p>
          </div>
        </aside>
        <section className="tools-workspace glass-panel" data-tools-workspace aria-busy="true">
          <p className="tools-loading" role="status" data-ui="Opening your toolbox…">
            <UiText message="Opening your toolbox…" />
          </p>
        </section>
      </div>
      <section
        className="tools-workspace tools-equation glass-panel"
        id="tools-equation"
        role="tabpanel"
        aria-labelledby="tools-tab-equation"
        data-tools-equation
        hidden
      />
      <footer className="tools-local-note">
        <Icon name="LockKeyhole" size={14} />
        <UiText message="Local processing. Draft saving is optional. Passwords and encryption content are never saved." />
        <button type="button" className="text-link" data-tools-clear-drafts>
          <UiText message="Delete saved drafts" />
        </button>
        <span role="status" data-tools-storage-status />
      </footer>
    </section>
  );
}
