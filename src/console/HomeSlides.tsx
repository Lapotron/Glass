import { t } from '../shared/i18n.js';
import { UiText } from '../shared/UiText.js';
import { useState } from 'react';
import { Button, Icon } from '../shared/ui.js';
import {
  type SiteConfig,
  type PublicEntry,
  type Library,
  type HomeSlide,
  homeSlideSchema,
} from '../shared/contracts.js';
import { defaultSlides, resolveSlides } from '../shared/home.js';
import { Field, MediaPicker } from './components.js';
export function HomeSlides({
  site,
  entries,
  library,
  onChange,
}: {
  site: SiteConfig;
  entries: PublicEntry[];
  library: Library;
  onChange: (home: Partial<SiteConfig['home']>) => void;
}) {
  const [picker, setPicker] = useState<string | null>(null);
  const model = { site, entries: entries.map((e) => ({ ...e, file: '' })), library };
  const slides = site.home.slides ?? defaultSlides(model);
  const resolved = resolveSlides(model);
  const update = (id: string, patch: Partial<HomeSlide>) =>
    onChange({ slides: slides.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  const move = (index: number, delta: number) => {
    const next = [...slides];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    onChange({ slides: next });
  };
  return (
    <section className="settings-card glass-panel home-slide-settings">
      <div className="settings-card-heading">
        <Icon name="Layers" />
        <h2 data-ui={"Visual chapters"}>{t("Visual chapters")}</h2>
      </div>
      <p className="help" data-ui={"Curate a quiet sequence of writing, photographs, and custom images. Blank overrides use the source’s text."}>
        {t("Curate a quiet sequence of writing, photographs, and custom images. Blank overrides use the source’s text.")}</p>
      <div className="home-slide-list">
        {slides.map((slide, index) => {
          const visual = resolved.find((s) => s.id === slide.id);
          const unavailable = slide.source !== 'custom' && !visual && slide.enabled;
          return (
            <details className="home-slide-edit" key={slide.id} open={slides.length === 1}>
              <summary>
                <span className="home-slide-order">{String(index + 1).padStart(2, '0')}</span>
                <span>{slide.title || visual?.title || t("New chapter")}</span>
                <Icon name="ChevronDown" size={14} />
              </summary>
              <div className="slide-fields">
                {visual?.image && (
                  <img
                    className="slide-thumbnail"
                    src={visual.image}
                    alt={t("Slide preview")}
                    style={{ objectPosition: `${slide.focalX}% ${slide.focalY}%` }}
                   data-ui-attrs={"{\"alt\":\"Slide preview\"}"} />
                )}
                <label className="toggle-row">
                  <span data-ui={"Show chapter"}>{t("Show chapter")}</span>
                  <input
                    type="checkbox"
                    role="switch"
                    checked={slide.enabled}
                    onChange={(e) => update(slide.id, { enabled: e.target.checked })}
                  />
                </label>
                <Field label={t("Chapter source")}>
                  <select
                    value={slide.source}
                    onChange={(e) =>
                      update(slide.id, {
                        source: e.target.value as HomeSlide['source'],
                        reference: '',
                        image: '',
                      })
                    }
                  >
                    <option value="entry" data-ui={"Published entry"}>{t("Published entry")}</option>
                    <option value="photo" data-ui={"Life photograph"}>{t("Life photograph")}</option>
                    <option value="custom" data-ui={"Custom visual"}>{t("Custom visual")}</option>
                  </select>
                </Field>
                {slide.source === 'entry' && (
                  <Field label={t("Article")}>
                    <select
                      value={slide.reference}
                      onChange={(e) => update(slide.id, { reference: e.target.value })}
                    >
                      <option value="" data-ui={"Choose an article"}>{t("Choose an article")}</option>
                      {entries.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.title}
                          {e.status !== 'published' ? t(" ({value0})", {value0: e.status}) : ''}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
                {slide.source === 'photo' && (
                  <Field label={t("Photograph")}>
                    <select
                      value={slide.reference}
                      onChange={(e) => update(slide.id, { reference: e.target.value })}
                    >
                      <option value="" data-ui={"Choose a photograph"}>{t("Choose a photograph")}</option>
                      {library.photos.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.caption || p.album}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
                {unavailable && (
                  <p className="help" role="status" data-ui={"This source is missing or unpublished. The chapter will be omitted from the public homepage."}>
                    {t("This source is missing or unpublished. The chapter will be omitted from the public homepage.")}</p>
                )}
                <div className="component-row">
                  <Button className="small" icon="Image" onClick={() => setPicker(slide.id)}>
                    {slide.image ? t("Change image override") : t("Choose image")}
                  </Button>
                  {slide.image && (
                    <Button className="small" onClick={() => update(slide.id, { image: '' })}>
                      <UiText message={"Use source image"}/></Button>
                  )}
                </div>
                <Field label={t("Title override")}>
                  <input
                    value={slide.title}
                    placeholder={visual?.title || t("A chapter title")}
                    onChange={(e) => update(slide.id, { title: e.target.value })}
                  />
                </Field>
                <Field label={t("Caption override")}>
                  <textarea
                    rows={3}
                    value={slide.caption}
                    onChange={(e) => update(slide.id, { caption: e.target.value })}
                  />
                </Field>
                <Field label={t("Image description")}>
                  <input
                    value={slide.alt}
                    placeholder={visual?.alt || t("Describe the visual")}
                    onChange={(e) => update(slide.id, { alt: e.target.value })}
                  />
                </Field>
                <Field label={t("Destination override")}>
                  <input
                    value={slide.href}
                    placeholder={visual?.href || t("/archive/")}
                    onChange={(e) => update(slide.id, { href: e.target.value })}
                  />
                </Field>
                <Field label={t("Horizontal focal point · {value0}%", {value0: slide.focalX})}>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={slide.focalX}
                    onChange={(e) => update(slide.id, { focalX: Number(e.target.value) })}
                  />
                </Field>
                <Field label={t("Vertical focal point · {value0}%", {value0: slide.focalY})}>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={slide.focalY}
                    onChange={(e) => update(slide.id, { focalY: Number(e.target.value) })}
                  />
                </Field>
                <div className="slide-edit-actions">
                  <Button
                    className="small"
                    icon="ArrowUp"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <UiText message={"Up"}/></Button>
                  <Button
                    className="small"
                    icon="ArrowDown"
                    disabled={index === slides.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <UiText message={"Down"}/></Button>
                  <Button
                    className="small"
                    icon="Copy"
                    onClick={() =>
                      onChange({
                        slides: [
                          ...slides.slice(0, index + 1),
                          { ...slide, id: crypto.randomUUID() },
                          ...slides.slice(index + 1),
                        ],
                      })
                    }
                  >
                    <UiText message={"Duplicate"}/></Button>
                  <Button
                    className="small"
                    icon="Trash2"
                    onClick={() => onChange({ slides: slides.filter((s) => s.id !== slide.id) })}
                  >
                    <UiText message={"Remove"}/></Button>
                </div>
              </div>
            </details>
          );
        })}
      </div>
      <Button
        className="small"
        icon="Plus"
        onClick={() =>
          onChange({
            slides: [
              ...slides,
              homeSlideSchema.parse({ id: crypto.randomUUID(), source: 'custom' }),
            ],
          })
        }
      >
        <UiText message={"Add chapter"}/></Button>
      <p className="help" data-ui={"Public navigation: Home · Archive · Life · About"}>{t("Public navigation: Home · Archive · Life · About")}</p>
      {picker && (
        <MediaPicker
          onClose={() => setPicker(null)}
          onSelect={(image) => {
            update(picker, { image });
            setPicker(null);
          }}
        />
      )}
    </section>
  );
}
