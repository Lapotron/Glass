import { t } from '../shared/i18n.js';
import { UiText } from '../shared/UiText.js';
import { useEffect, useRef, useState } from 'react';
import {
  projectSchema,
  projectsSchema,
  projectStatusLabels,
  type Project,
  type Projects as ProjectCollection,
} from '../shared/projects.js';
import { openImageViewer } from '../shared/image-viewer.js';
import { Button, Icon } from '../shared/ui.js';
import { send } from './api.js';
import { Modal, Field, ErrorBox, PageHeading, MediaPicker } from './components.js';
import type { FlushRef } from './Editor.js';
import { LivePreview, PreviewError, useLivePreview } from './LivePreview.js';
import './projects.css';
export function Projects({
  value,
  revision,
  flushRef,
  onSaved,
  onStatus,
}: {
  value: ProjectCollection;
  revision: string;
  flushRef: FlushRef;
  onSaved: (value: ProjectCollection, revision: string) => void;
  onStatus: (status: string) => void;
}) {
  const [importFields, setImportFields] = useState([
    'title',
    'description',
    'technologies',
    'links',
  ]);
  const [draft, setDraft] = useState(value),
    [selected, setSelected] = useState(value.projects[0]?.id || ''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [conflict, setConflict] = useState(false),
    [picker, setPicker] = useState(false),
    [remove, setRemove] = useState(false),
    [repository, setRepository] = useState(''),
    [imported, setImported] = useState<Project | null>(null),
    [technologyInput, setTechnologyInput] = useState<{
      projectId: string;
      text: string;
      normalized: string;
    } | null>(null),
    [undo, setUndo] = useState('');
  const baseline = useRef(value),
    rev = useRef(revision),
    latest = useRef(draft),
    saving = useRef<Promise<void> | null>(null),
    blocked = useRef(false);
  latest.current = draft;
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline.current);
  useEffect(() => {
    if (revision === rev.current) return;
    if (JSON.stringify(latest.current) !== JSON.stringify(baseline.current)) {
      blocked.current = true;
      setConflict(true);
      return;
    }
    baseline.current = value;
    rev.current = revision;
    latest.current = value;
    setDraft(value);
  }, [revision]);
  const save = async () => {
    if (saving.current) return saving.current;
    if (JSON.stringify(latest.current) === JSON.stringify(baseline.current)) return;
    if (blocked.current)
      throw new Error(
        'Projects changed outside Studio. Reload before saving; your draft is still here.',
      );
    const submittedText = JSON.stringify(latest.current);
    const submitted = projectsSchema.parse(latest.current);
    setBusy(true);
    setError('');
    saving.current = (async () => {
      try {
        const result = await send<{ value: ProjectCollection; revision: string }>(
          'projects',
          'PUT',
          { value: submitted, revision: rev.current },
        );
        baseline.current = result.value;
        rev.current = result.revision;
        if (JSON.stringify(latest.current) === submittedText) {
          latest.current = result.value;
          setDraft(result.value);
        }
        setUndo(result.revision);
        onSaved(result.value, result.revision);
      } catch (failure) {
        setError((failure as Error).message);
        if ((failure as { status?: number }).status === 409) {
          blocked.current = true;
          setConflict(true);
        }
        throw failure;
      } finally {
        saving.current = null;
        setBusy(false);
      }
    })();
    return saving.current;
  };
  const actions = useRef(save);
  actions.current = save;
  useEffect(() => {
    flushRef.current = () => actions.current();
    const leave = (event: BeforeUnloadEvent) => {
      if (JSON.stringify(latest.current) !== JSON.stringify(baseline.current)) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    addEventListener('beforeunload', leave);
    return () => {
      flushRef.current = null;
      removeEventListener('beforeunload', leave);
    };
  }, []);
  useEffect(
    () => onStatus(busy ? 'Saving projects…' : dirty ? 'Unsaved projects' : 'All changes saved'),
    [busy, dirty],
  );
  const current = draft.projects.find((p) => p.id === selected);
  const update = (patch: Partial<Project>) =>
    setDraft((d) => ({
      ...d,
      projects: d.projects.map((p) => (p.id === selected ? { ...p, ...patch } : p)),
    }));
  const add = (
    project = projectSchema.parse({ id: crypto.randomUUID(), title: 'Untitled project' }),
  ) => {
    setDraft((d) => ({ ...d, projects: [...d.projects, project] }));
    setSelected(project.id);
  };
  const move = (delta: number) => {
    const projects = [...draft.projects],
      index = projects.findIndex((p) => p.id === selected);
    if (index + delta < 0 || index + delta >= projects.length) return;
    [projects[index], projects[index + delta]] = [projects[index + delta], projects[index]];
    setDraft({ ...draft, projects });
  };
  const preview = useLivePreview({
    identity: 'projects',
    source: JSON.stringify(draft),
    request: { route: '/projects/', projects: draft },
  });
  const safely = (task: () => Promise<unknown>) => {
    void task().catch((failure) => setError((failure as Error).message));
  };
  return (
    <div className="studio-page">
      <PageHeading
        eyebrow={t('Build in public')}
        title={t('Projects')}
        description={t('Curate your work, choose what’s public, and arrange it in your own order.')}
      />
      <ErrorBox error={error} />
      {conflict && (
        <div role="alert" className="notice">
          <UiText message={'Your changes are preserved.'} />{' '}
          <Button
            onClick={() => {
              setDraft(value);
              baseline.current = value;
              rev.current = revision;
              blocked.current = false;
              setConflict(false);
            }}
          >
            <UiText message={'Reload latest projects'} />
          </Button>
        </div>
      )}
      <div className="page-actions">
        <Button icon="Plus" onClick={() => add()}>
          <UiText message={'New project'} />
        </Button>
        <Button icon="Save" disabled={busy || !dirty || conflict} onClick={() => safely(save)}>
          <UiText message={'Save projects'} />
        </Button>
        {undo && !dirty && (
          <Button
            icon="Undo2"
            onClick={() =>
              safely(async () => {
                const result = await send<{ value: ProjectCollection; revision: string }>(
                  'projects/undo',
                  'POST',
                  { revision: undo },
                );
                setDraft(result.value);
                baseline.current = result.value;
                rev.current = result.revision;
                setUndo('');
                onSaved(result.value, result.revision);
              })
            }
          >
            <UiText message={'Undo last save'} />
          </Button>
        )}
      </div>
      <div className="project-studio-layout">
        <aside className="settings-card glass-panel project-list">
          <h2 data-ui={'Your projects'}>{t('Your projects')}</h2>
          {draft.projects.map((p) => (
            <button
              type="button"
              key={p.id}
              className="project-select"
              aria-pressed={p.id === selected}
              onClick={() => setSelected(p.id)}
            >
              <Icon name="Code2" size={16} />
              <span>
                {p.title}
                <small>
                  {p.visibility === 'public' ? t('Public') : t('Draft')} ·{' '}
                  {projectStatusLabels[p.status]}
                </small>
              </span>
            </button>
          ))}
          <Field
            label={t('Public GitHub repository')}
            help={t('Import selected public metadata. Review changes before applying.')}
          >
            <input
              placeholder={t('owner/repository')}
              value={repository}
              onChange={(e) => setRepository(e.target.value)}
              data-ui-attrs={'{"placeholder":"owner/repository"}'}
            />
          </Field>
          <Button
            icon="Github"
            disabled={busy || !repository}
            onClick={() =>
              safely(async () => {
                setBusy(true);
                try {
                  setImported(await send<Project>('projects/github', 'POST', { repository }));
                } finally {
                  setBusy(false);
                }
              })
            }
          >
            <UiText message={'Review GitHub import'} />
          </Button>
        </aside>
        <div className="project-editor">
          {current ? (
            <section className="settings-card glass-panel">
              <div className="settings-card-heading">
                <Icon name="Code2" />
                <h2 data-ui={'Project details'}>{t('Project details')}</h2>
              </div>
              <div className="field-grid">
                <Field label={t('Title')}>
                  <input
                    value={current.title}
                    maxLength={160}
                    onChange={(e) => update({ title: e.target.value })}
                  />
                </Field>
                <Field label={t('Visibility')}>
                  <select
                    value={current.visibility}
                    onChange={(e) =>
                      update({ visibility: e.target.value as Project['visibility'] })
                    }
                  >
                    <option value="draft" data-ui={'Draft — private'}>
                      {t('Draft — private')}
                    </option>
                    <option value="public" data-ui={'Public — include in next build'}>
                      {t('Public — include in next build')}
                    </option>
                  </select>
                </Field>
                <Field label={t('Development status')}>
                  <select
                    value={current.status}
                    onChange={(e) => update({ status: e.target.value as Project['status'] })}
                  >
                    {Object.entries(projectStatusLabels).map(([key, label]) => (
                      <option value={key} key={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label={t('Description')}>
                <textarea
                  rows={4}
                  maxLength={2000}
                  value={current.description}
                  onChange={(e) => update({ description: e.target.value })}
                />
              </Field>
              <Field label={t('Technologies')} help={t('Separate technologies with commas.')}>
                <input
                  value={
                    technologyInput?.projectId === current.id &&
                    technologyInput.normalized === JSON.stringify(current.technologies)
                      ? technologyInput.text
                      : current.technologies.join(', ')
                  }
                  onChange={(e) => {
                    const text = e.target.value;
                    const technologies = text
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean);
                    setTechnologyInput({
                      projectId: current.id,
                      text,
                      normalized: JSON.stringify(technologies),
                    });
                    update({ technologies });
                  }}
                  onBlur={() => setTechnologyInput(null)}
                />
              </Field>
              <div className="project-cover">
                {current.image && (
                  <a
                    href={current.image}
                    onClick={(event) => {
                      event.preventDefault();
                      void openImageViewer(
                        [{ src: current.image, alt: current.imageAlt || current.title }],
                        0,
                        event.currentTarget,
                      );
                    }}
                  >
                    <img src={current.image} alt={current.imageAlt} />
                  </a>
                )}
                <Button icon="Image" onClick={() => setPicker(true)}>
                  <UiText message={'Choose cover'} />
                </Button>
                {current.image && (
                  <Button onClick={() => update({ image: '' })}>
                    <UiText message={'Remove cover'} />
                  </Button>
                )}
              </div>
              <Field label={t('Image description')}>
                <input
                  value={current.imageAlt}
                  onChange={(e) => update({ imageAlt: e.target.value })}
                />
              </Field>
              <h3 data-ui={'Links'}>{t('Links')}</h3>
              {current.links.map((link, index) => (
                <div className="project-link-edit" key={index}>
                  <input
                    aria-label={t('Link {value0} label', { value0: index + 1 })}
                    value={link.label}
                    onChange={(e) =>
                      update({
                        links: current.links.map((l, i) =>
                          i === index ? { ...l, label: e.target.value } : l,
                        ),
                      })
                    }
                  />
                  <input
                    aria-label={t('Link {value0} URL', { value0: index + 1 })}
                    type="url"
                    value={link.url}
                    onChange={(e) =>
                      update({
                        links: current.links.map((l, i) =>
                          i === index ? { ...l, url: e.target.value } : l,
                        ),
                      })
                    }
                  />
                  <Button
                    icon="X"
                    aria-label={t('Remove link')}
                    onClick={() => update({ links: current.links.filter((_, i) => i !== index) })}
                  />
                </div>
              ))}
              <div className="page-actions">
                <Button
                  icon="Plus"
                  disabled={current.links.length >= 8}
                  onClick={() =>
                    update({ links: [...current.links, { label: 'Website', url: 'https://' }] })
                  }
                >
                  <UiText message={'Add link'} />
                </Button>
                <Button icon="ArrowUp" onClick={() => move(-1)}>
                  <UiText message={'Move earlier'} />
                </Button>
                <Button icon="ArrowDown" onClick={() => move(1)}>
                  <UiText message={'Move later'} />
                </Button>
                <Button icon="Trash2" onClick={() => setRemove(true)}>
                  <UiText message={'Remove project'} />
                </Button>
                {current.github && (
                  <Button
                    icon="RotateCcw"
                    onClick={() => {
                      setRepository(current.github);
                      safely(async () =>
                        setImported(
                          await send<Project>('projects/github', 'POST', {
                            repository: current.github,
                          }),
                        ),
                      );
                    }}
                  >
                    <UiText message={'Review GitHub refresh'} />
                  </Button>
                )}
              </div>
            </section>
          ) : (
            <div
              className="empty-state glass-panel"
              data-ui={'Create a project or import a public repository to begin.'}
            >
              {t('Create a project or import a public repository to begin.')}
            </div>
          )}
          <section className="settings-card glass-panel project-preview">
            <h2 data-ui={'Preview'}>{t('Preview')}</h2>
            <p
              className="help"
              data-ui={
                'Drafts are visible only in this private preview. Build to refresh the public page.'
              }
            >
              {t(
                'Drafts are visible only in this private preview. Build to refresh the public page.',
              )}
            </p>
            <PreviewError controller={preview} />
            <LivePreview controller={preview} identity="projects" title={t('Projects preview')} />
          </section>
        </div>
      </div>
      {picker && (
        <MediaPicker
          onClose={() => setPicker(false)}
          onSelect={(image) => {
            update({ image });
            setPicker(false);
          }}
        />
      )}{' '}
      {remove && current && (
        <Modal
          title={t('Remove {value0}?', { value0: current.title })}
          onClose={() => setRemove(false)}
          footer={
            <>
              <Button onClick={() => setRemove(false)}>
                <UiText message={'Cancel'} />
              </Button>
              <Button
                onClick={() => {
                  setDraft({ ...draft, projects: draft.projects.filter((p) => p.id !== selected) });
                  setSelected('');
                  setRemove(false);
                }}
              >
                <UiText message={'Remove project'} />
              </Button>
            </>
          }
        >
          <p
            data-ui={
              'The project will be removed on save. You can undo that save or restore a notebook backup.'
            }
          >
            {t(
              'The project will be removed on save. You can undo that save or restore a notebook backup.',
            )}
          </p>
        </Modal>
      )}
      {imported && (
        <Modal
          title={t('Review GitHub metadata')}
          onClose={() => setImported(null)}
          footer={
            <>
              <Button onClick={() => setImported(null)}>
                <UiText message={'Cancel'} />
              </Button>
              {current?.github?.toLowerCase() === imported.github.toLowerCase() ? (
                <Button
                  onClick={() => {
                    update({
                      ...(importFields.includes('title') ? { title: imported.title } : {}),
                      ...(importFields.includes('description')
                        ? { description: imported.description }
                        : {}),
                      ...(importFields.includes('technologies')
                        ? { technologies: imported.technologies }
                        : {}),
                      ...(importFields.includes('links') ? { links: imported.links } : {}),
                      updatedAt: imported.updatedAt,
                    });
                    setImported(null);
                  }}
                >
                  <UiText message={'Apply selected fields'} />
                </Button>
              ) : (
                <Button
                  onClick={() => {
                    add(imported);
                    setImported(null);
                  }}
                >
                  <UiText message={'Add as draft'} />
                </Button>
              )}
            </>
          }
        >
          {current?.github?.toLowerCase() === imported.github.toLowerCase() && (
            <fieldset>
              <legend data-ui={'Fields to refresh'}>{t('Fields to refresh')}</legend>
              {['title', 'description', 'technologies', 'links'].map((field) => (
                <label className="check-row" key={field}>
                  <input
                    type="checkbox"
                    checked={importFields.includes(field)}
                    onChange={(e) =>
                      setImportFields((fields) =>
                        e.target.checked
                          ? [...fields, field]
                          : fields.filter((value) => value !== field),
                      )
                    }
                  />
                  {field}
                </label>
              ))}
            </fieldset>
          )}
          <h3>{imported.title}</h3>
          <p>{imported.description}</p>
          <p>{imported.technologies.join(' · ')}</p>
          <ul>
            {imported.links.map((link) => (
              <li key={link.url}>
                {link.label}: {link.url}
              </li>
            ))}
          </ul>
          <p
            className="help"
            data-ui={
              'Refresh replaces title, description, technologies, and links. Cover, visibility, status, stable ID and position stay as you set them.'
            }
          >
            {t(
              'Refresh replaces title, description, technologies, and links. Cover, visibility, status, stable ID and position stay as you set them.',
            )}
          </p>
        </Modal>
      )}
    </div>
  );
}
